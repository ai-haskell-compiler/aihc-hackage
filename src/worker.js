import { parseCabal } from './parser.js';
import { contentDigest, importDocuments, documentMetadata } from './documents.js';

const MAX_CABAL = 1024 * 1024;
const NAME = /^(?=.{1,128}$)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const VERSION = /^(?=.{1,128}$)\d{1,9}(?:\.\d{1,9})*$/;
const field = (metadata, name) => (metadata.fields[name] || []).join('\n');
const summaryColumns = 'name, version, synopsis, license, imported_at';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
async function limitedBytes(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new HttpError(413, 'The file exceeds the size limit.');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new HttpError(413, 'The file exceeds the size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
function validateName(name) {
  if (!NAME.test(name) || !name.split('-').every(part => /[A-Za-z]/.test(part))) {
    throw new HttpError(400, 'Enter a valid Hackage package name.');
  }
}
function validateVersion(version) {
  if (!VERSION.test(version)) throw new HttpError(400, 'Enter a numeric package version.');
}
function collect(metadata) {
  const dependencies = [];
  const modules = new Set();
  function walk(tree, component, conditions) {
    for (const name of tree.data.exposedModules) modules.add(name);
    for (const dep of tree.data.dependencies) {
      dependencies.push({ ...dep, component, conditions });
    }
    for (const branch of tree.branches) {
      walk(branch.then, component, [...conditions, branch.condition]);
      if (branch.else) walk(branch.else, component, [...conditions, { not: branch.condition }]);
    }
  }
  for (const component of metadata.components) walk(component.tree, `${component.kind}:${component.name}`, []);
  for (const dep of metadata.setupDependencies) dependencies.push({ ...dep, component: 'custom-setup', conditions: [] });
  return { dependencies, modules: [...modules] };
}
async function importPackage(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Use the import form on this site.');
  const rate = await env.IMPORT_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
  if (!rate.success) throw new HttpError(429, 'The import limit is ten requests per minute.');
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(await limitedBytes(request, 2048))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'The request contains invalid JSON.'); }
  const { name, version } = payload || {};
  if (typeof name !== 'string') throw new HttpError(400, 'Enter a package name.');
  validateName(name);
  if (typeof version !== 'string') throw new HttpError(400, 'Enter a package version.');
  validateVersion(version);
  const sourceUrl = `https://hackage.haskell.org/package/${name}-${version}/${name}.cabal`;
  const response = await fetch(sourceUrl, {
    redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Accept: 'text/plain', 'User-Agent': 'aihc-hackage/0.1 (https://hackage.aihc.app)' },
  });
  if (response.status === 404) throw new HttpError(404, 'Hackage does not have this package version.');
  if (!response.ok) throw new HttpError(502, 'Hackage could not supply the Cabal file.');
  const bytes = await limitedBytes(response, MAX_CABAL);
  let metadata;
  try { metadata = await parseCabal(bytes); }
  catch (error) { throw new HttpError(422, `The Cabal parser failed: ${error.message}`); }
  if (metadata.name !== name || metadata.version !== version) throw new HttpError(422, 'The Cabal file has a different package name or version.');
  const { dependencies, modules } = collect(metadata);
  if (dependencies.length > 2000) throw new HttpError(413, 'The package exceeds the dependency limit.');
  const sha256 = await contentDigest(bytes);
  const importedAt = new Date().toISOString();
  const prefix = `packages/${name}/${version}/${sha256}`;
  const cabalKey = `${prefix}.cabal`;
  const metadataKey = `${prefix}.json`;
  const complete = { ...metadata, sourceUrl, sha256, importedAt, dependencies, exposedModules: modules };
  // Store immutable objects before the database points to them.
  await env.CABAL.put(cabalKey, bytes, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
  await env.CABAL.put(metadataKey, JSON.stringify(complete), { httpMetadata: { contentType: 'application/json' } });
  const documentStatements = await importDocuments(name, version, env, limitedBytes);
  const upsert = env.DB.prepare(`INSERT INTO releases
    (name, version, version_sort, synopsis, description, license, modules, metadata_key, cabal_key, sha256, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name, version) DO UPDATE SET synopsis=excluded.synopsis, description=excluded.description,
    license=excluded.license, modules=excluded.modules, metadata_key=excluded.metadata_key,
    cabal_key=excluded.cabal_key, sha256=excluded.sha256, imported_at=excluded.imported_at`)
    .bind(name, version, version.split('.').map(part => part.padStart(10, '0')).join('.'),
      field(metadata, 'synopsis'), field(metadata, 'description'), field(metadata, 'license'), modules.join(' '), metadataKey, cabalKey, sha256, importedAt);
  // One transaction replaces the version and its dependency index.
  const statements = [upsert, env.DB.prepare('DELETE FROM dependencies WHERE name=? AND version=?').bind(name, version)];
  for (const dep of dependencies) statements.push(env.DB.prepare(`INSERT INTO dependencies
    (name, version, dependency, component, version_range, condition, libraries) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(name, version, dep.package, dep.component, dep.range, JSON.stringify(dep.conditions), JSON.stringify(dep.libraries)));
  statements.push(...documentStatements.filter(Boolean));
  await env.DB.batch(statements);
  return json({ name, version, sha256, warnings: metadata.warnings }, 201);
}
async function search(url, env) {
  const query = (url.searchParams.get('q') || '').trim();
  if (query.length > 200) throw new HttpError(400, 'The search text exceeds 200 characters.');
  const offset = Number(url.searchParams.get('offset') || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new HttpError(400, 'The page offset is invalid.');
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) || [];
  const matches = tokens.map(token => `"${token}"*`).join(' AND ');
  let result;
  if (matches) {
    result = await env.DB.prepare(`SELECT ${summaryColumns.split(', ').map(c => `r.${c}`).join(', ')}
      FROM releases r WHERE r.rowid IN (SELECT rowid FROM releases_fts WHERE releases_fts MATCH ?)
      AND r.version_sort=(SELECT MAX(v.version_sort) FROM releases v WHERE v.name=r.name)
      ORDER BY r.name LIMIT 31 OFFSET ?`).bind(matches, offset).all();
  } else if (query) return json({ packages: [], hasMore: false, offset });
  else result = await env.DB.prepare(`SELECT ${summaryColumns} FROM releases r
    WHERE version_sort=(SELECT MAX(v.version_sort) FROM releases v WHERE v.name=r.name)
    ORDER BY name LIMIT 31 OFFSET ?`).bind(offset).all();
  return json({ packages: result.results.slice(0, 30), hasMore: result.results.length > 30, offset });
}
async function packageDetail(name, version, env) {
  validateName(name);
  const versions = await env.DB.prepare('SELECT version, imported_at FROM releases WHERE name=? ORDER BY version_sort DESC').bind(name).all();
  if (!versions.results.length) throw new HttpError(404, 'This package has no imported versions.');
  const selected = version || versions.results[0].version;
  validateVersion(selected);
  const row = await env.DB.prepare('SELECT metadata_key FROM releases WHERE name=? AND version=?').bind(name, selected).first();
  if (!row) throw new HttpError(404, 'This package version has not been imported.');
  const object = await env.CABAL.get(row.metadata_key);
  if (!object) throw new HttpError(503, 'The package metadata is not available.');
  const metadata = await object.json();
  return json({ ...metadata, documents: await documentMetadata(name, selected, env), versions: versions.results });
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (request.method === 'POST' && url.pathname === '/api/import') return await importPackage(request, env);
      if (request.method !== 'GET') throw new HttpError(405, 'This method is not available.');
      if (url.pathname === '/api/packages') return await search(url, env);
      const match = /^\/api\/packages\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (match) return await packageDetail(decodeURIComponent(match[1]), match[2] && decodeURIComponent(match[2]), env);
      const reverse = /^\/api\/reverse\/([^/]+)$/.exec(url.pathname);
      if (reverse) {
        const name = decodeURIComponent(reverse[1]); validateName(name);
        const result = await env.DB.prepare(`SELECT DISTINCT name, version, component, version_range, condition, libraries
          FROM dependencies WHERE dependency=? ORDER BY name, version LIMIT 201`).bind(name).all();
        return json({ dependencies: result.results.slice(0, 200), truncated: result.results.length > 200 });
      }
      const document = /^\/api\/(readme|changelog)\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (document) {
        const kind = document[1];
        const name = decodeURIComponent(document[2]); const version = decodeURIComponent(document[3]);
        validateName(name); validateVersion(version);
        const release = await env.DB.prepare('SELECT 1 FROM releases WHERE name=? AND version=?').bind(name, version).first();
        if (!release) throw new HttpError(404, 'This package version has not been imported.');
        const row = await env.DB.prepare('SELECT status, object_key, error, sha256 FROM package_documents WHERE name=? AND version=? AND kind=?')
          .bind(name, version, kind).first();
        if (!row) throw new HttpError(404, 'The document has not been imported. Import this version again.');
        if (row.status === 'missing') throw new HttpError(404, 'Hackage does not have this document.');
        if (row.status === 'failed') throw new HttpError(503, row.error);
        const object = await env.CABAL.get(row.object_key);
        if (!object) throw new HttpError(503, 'The document is not available.');
        return new Response(object.body, { headers: {
          'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=86400', ETag: `"${row.sha256}"`,
        } });
      }
      const raw = /^\/api\/cabal\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (raw) {
        const name = decodeURIComponent(raw[1]); const version = decodeURIComponent(raw[2]);
        validateName(name); validateVersion(version);
        const row = await env.DB.prepare('SELECT cabal_key FROM releases WHERE name=? AND version=?').bind(name, version).first();
        if (!row) throw new HttpError(404, 'This package version has not been imported.');
        const object = await env.CABAL.get(row.cabal_key);
        if (!object) throw new HttpError(503, 'The Cabal file is not available.');
        return new Response(object.body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' } });
      }
      throw new HttpError(404, 'This page does not exist.');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(JSON.stringify({ event: 'request-error', message: error.message }));
      return json({ error: 'The request failed. Please try again.' }, 500);
    }
  },
};
