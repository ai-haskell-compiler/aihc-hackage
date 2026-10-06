import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const source = await readFile(new URL('fixtures/sample.cabal', import.meta.url), 'utf8');
const invalid = await readFile(new URL('fixtures/invalid.cabal', import.meta.url), 'utf8');
let revision = source;
let outboundCount = 0;
const outboundUrls = [];
const archive = new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3, 4]);
const readme = '# Sample\n\nA README with λ and <script>alert("unsafe")</script>.\n';
const changelog = '# Changes\n\n* Add a sample module.\n';
const documentRequests = [];
const documentResponses = new Map([
  ['/package/sample-1.2.0/readme.txt', () => new Response(readme)],
  ['/package/sample-1.2.0/changelog.txt', () => new Response('Unavailable', { status: 503 })],
]);
const mf = new Miniflare(convertV4MiniflareOptions({
  modulesRoot: 'dist', modules: [{ type: 'ESModule', path: 'dist/worker.js' },
    ...(await readdir('dist')).filter(name => name.endsWith('.wasm')).map(name => ({ type: 'CompiledWasm', path: `dist/${name}` }))],
  compatibilityDate: '2026-10-03', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'], r2Buckets: ['CABAL'], ratelimits: { IMPORT_LIMIT: { namespace_id: '1001', simple: { limit: 10, period: 60 } } },
  assets: { directory: 'public', binding: 'ASSETS', run_worker_first: ['/', '/search', '/package/*', '/api/*', '/hackage/*', '/sitemap.xml', '/robots.txt'], routerConfig: { has_user_worker: true } },
  outboundService: async request => {
    outboundCount++;
    outboundUrls.push(request.url);
    assert.equal(new URL(request.url).hostname, 'hackage.haskell.org');
    const path = new URL(request.url).pathname;
    if (/\/(readme|changelog)\.txt$/.test(path)) {
      documentRequests.push(path);
      return documentResponses.get(path)?.() || new Response('Missing', { status: 404 });
    }
    if (path === '/package/sample-1.2.0/sample.cabal') return new Response(revision);
    if (path === '/package/sample-1.2.0/sample-1.2.0.tar.gz') return new Response(archive, { headers: { 'Content-Type': 'application/x-gzip' } });
    if (path === '/package/large-1.0/large-1.0.tar.gz') return new Response('x', { headers: { 'Content-Length': String(65 * 1024 * 1024) } });
    if (path === '/package/moved-1.0/moved-1.0.tar.gz') return new Response('', { status: 302, headers: { Location: 'https://other.test' } });
    if (path === '/package/sample-1.10.0/sample.cabal') return new Response(source.replace('version: 1.2.0', 'version: 1.10.0'));
    if (path === '/package/broken-1.0/broken.cabal') return new Response(invalid);
    if (path === '/package/huge-1.0/huge.cabal') return new Response('a'.repeat(1048577));
    if (path === '/package/redirect-1.0/redirect.cabal') return new Response('', { status: 302, headers: { Location: 'https://other.test' } });
    if (path === '/package/mismatch-1.0/mismatch.cabal') return new Response(source);
    return new Response('Missing', { status: 404 });
  },
}));
const db = await mf.getD1Database('DB');
for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) {
  const migration = await readFile(`migrations/${file}`, 'utf8');
  await db.exec(migration.replaceAll('\n', ' '));
}
let address = 1;
async function request(path, body, extraHeaders = {}) {
  const response = await mf.dispatchFetch(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${address++}`, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
test('The Worker proxies only package archives and Cabal files from Hackage.', async () => {
  outboundUrls.length = 0;
  const archiveResponse = await mf.dispatchFetch('http://localhost/hackage/package/sample-1.2.0/sample-1.2.0.tar.gz');
  assert.equal(archiveResponse.status, 200);
  assert.equal(archiveResponse.headers.get('content-type'), 'application/gzip');
  assert.equal(archiveResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual([...new Uint8Array(await archiveResponse.arrayBuffer())], [...archive]);
  const cabalResponse = await mf.dispatchFetch('http://localhost/hackage/package/sample-1.2.0/sample.cabal');
  assert.equal(cabalResponse.status, 200);
  assert.match(cabalResponse.headers.get('content-type'), /^text\/plain/);
  assert.deepEqual(outboundUrls, ['https://hackage.haskell.org/package/sample-1.2.0/sample-1.2.0.tar.gz', 'https://hackage.haskell.org/package/sample-1.2.0/sample.cabal']);
  // Other paths do not reach Hackage.
  outboundUrls.length = 0;
  for (const path of ['/hackage/01-index.tar.gz', '/hackage/package/sample-1.2.0/other.tar.gz', '/hackage/package/sample-1.2.0/../x.cabal',
    '/hackage/package/sample/sample.tar.gz', '/hackage/users/', '/hackage/package/sample-1.2.0/sample-1.2.0.tar.gz/extra']) {
    assert.equal((await mf.dispatchFetch(`http://localhost${path}`)).status, 404, path);
  }
  assert.equal((await mf.dispatchFetch('http://localhost/hackage/package/sample-1.2.0/sample-1.2.0.tar.gz', { method: 'POST', body: 'x' })).status, 405);
  assert.deepEqual(outboundUrls, []);
  assert.equal((await mf.dispatchFetch('http://localhost/hackage/package/missing-1.0/missing-1.0.tar.gz')).status, 404);
  assert.equal((await mf.dispatchFetch('http://localhost/hackage/package/large-1.0/large-1.0.tar.gz')).status, 413);
  assert.equal((await mf.dispatchFetch('http://localhost/hackage/package/moved-1.0/moved-1.0.tar.gz')).status, 502);
  // The import tests count outbound requests.
  outboundCount = 0; outboundUrls.length = 0;
});

test('The Worker imports Cabal source into R2 and D1.', async () => {
  try {
    assert.equal((await request('/api/packages')).data.packages.length, 0);
    assert.equal((await request('/api/import', { name: 'sample', version: '1.2.0' })).status, 201);
    const detail = await request('/api/packages/sample');
    assert.equal(detail.data.version, '1.2.0');
    assert.deepEqual(detail.data.exposedModules, ['Sample.Main', 'Sample.Extra']);
    assert.equal(detail.data.dependencies.length, 3);
    assert.equal(detail.data.fields.license[0], 'BSD-3-Clause');
    assert.equal(detail.data.documents.readme.status, 'available');
    assert.match(detail.data.documents.readme.sha256, /^[a-f0-9]{64}$/);
    assert.equal(detail.data.documents.changelog.status, 'failed');
    assert.match(detail.data.documents.changelog.error, /try again/);
    assert.equal((await request('/api/changelog/sample/1.2.0')).status, 503);
    const savedReadme = await mf.dispatchFetch('http://localhost/api/readme/sample/1.2.0');
    assert.equal(savedReadme.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(savedReadme.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(savedReadme.headers.get('etag'), `"${detail.data.documents.readme.sha256}"`);
    assert.equal(await savedReadme.text(), readme);
    assert.equal((await request('/api/packages?q=Sample.Main')).data.packages[0].name, 'sample');
    assert.equal((await request('/api/packages?q=small')).data.packages.length, 1);
    const reverse = await request('/api/reverse/text');
    assert.equal(reverse.data.dependencies[0].name, 'sample');
    assert.deepEqual(JSON.parse(reverse.data.dependencies[0].condition), [{ flag: 'extra' }]);
    const raw = await mf.dispatchFetch('http://localhost/api/cabal/sample/1.2.0');
    assert.equal(await raw.text(), source);
    // The revised fixture must replace the search and dependency indexes.
    revision = source.replace('A small package', 'Revised catalogue entry').replace('text >=2', 'containers >=0.6');
    documentResponses.set('/package/sample-1.2.0/changelog.txt', () => new Response(changelog));
    const documentsBeforeRevision = documentRequests.length;
    assert.equal((await request('/api/import', { name: 'sample', version: '1.2.0' })).status, 201);
    assert.deepEqual(documentRequests.slice(documentsBeforeRevision), ['/package/sample-1.2.0/changelog.txt']);
    assert.equal((await request('/api/packages/sample/1.2.0')).data.documents.changelog.status, 'available');
    assert.equal(await (await mf.dispatchFetch('http://localhost/api/changelog/sample/1.2.0')).text(), changelog);
    assert.equal((await request('/api/reverse/text')).data.dependencies.length, 0);
    assert.equal((await request('/api/reverse/containers')).data.dependencies.length, 1);
    assert.equal((await request('/api/packages?q=small')).data.packages.length, 0);
    assert.equal((await request('/api/packages?q=Revised')).data.packages.length, 1);
    assert.equal((await request('/api/import', { name: 'sample', version: '1.10.0' })).status, 201);
    assert.equal((await request('/api/packages/sample')).data.version, '1.10.0');
    assert.deepEqual((await request('/api/packages/sample')).data.versions.map(v => v.version), ['1.10.0', '1.2.0']);
    assert.equal((await request('/api/packages/sample')).data.documents.readme.status, 'missing');
    assert.equal((await request('/api/readme/sample/1.10.0')).status, 404);
    const documentsBeforeRepeat = documentRequests.length;
    assert.equal((await request('/api/import', { name: 'sample', version: '1.10.0' })).status, 201);
    assert.equal((await request('/api/import', { name: 'sample', version: '1.2.0' })).status, 201);
    assert.equal(documentRequests.length, documentsBeforeRepeat);
    // A release imported before the document migration can get documents on a repeated import.
    await db.prepare('DELETE FROM package_documents WHERE name=? AND version=?').bind('sample', '1.10.0').run();
    assert.equal((await request('/api/packages/sample')).data.documents.readme.status, 'not_imported');
    assert.equal((await request('/api/readme/sample/1.10.0')).status, 404);
    documentResponses.set('/package/sample-1.10.0/readme.txt', () => new Response('', {
      headers: { 'Content-Length': '1048577' },
    }));
    documentResponses.set('/package/sample-1.10.0/changelog.txt', () => new Response('', {
      status: 302, headers: { Location: 'https://other.test' },
    }));
    assert.equal((await request('/api/import', { name: 'sample', version: '1.10.0' })).status, 201);
    let documents = (await request('/api/packages/sample')).data.documents;
    assert.match(documents.readme.error, /size limit/);
    assert.equal(documents.changelog.status, 'failed');
    // Enforce the size limit when the response has no Content-Length header.
    documentResponses.set('/package/sample-1.10.0/readme.txt', () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(524288));
        controller.enqueue(new Uint8Array(524289));
        controller.close();
      },
    })));
    documentResponses.set('/package/sample-1.10.0/changelog.txt', () => { throw new DOMException('Timed out', 'TimeoutError'); });
    assert.equal((await request('/api/import', { name: 'sample', version: '1.10.0' })).status, 201);
    documents = (await request('/api/packages/sample')).data.documents;
    assert.match(documents.readme.error, /size limit/);
    assert.equal(documents.changelog.status, 'failed');
    assert.equal((await request('/api/readme/sample/1.10.0')).status, 503);
    documentResponses.set('/package/sample-1.10.0/readme.txt', () => new Response(''));
    documentResponses.set('/package/sample-1.10.0/changelog.txt', () => new Response('Missing', { status: 404 }));
    assert.equal((await request('/api/import', { name: 'sample', version: '1.10.0' })).status, 201);
    documents = (await request('/api/packages/sample')).data.documents;
    assert.equal(documents.readme.status, 'available');
    assert.equal(documents.readme.error, null);
    assert.equal(documents.changelog.status, 'missing');
    assert.equal(await (await mf.dispatchFetch('http://localhost/api/readme/sample/1.10.0')).text(), '');
    const saved = await db.prepare('SELECT object_key FROM package_documents WHERE name=? AND version=? AND kind=?')
      .bind('sample', '1.10.0', 'readme').first();
    await (await mf.getR2Bucket('CABAL')).delete(saved.object_key);
    assert.equal((await request('/api/readme/sample/1.10.0')).status, 503);
    const before = outboundCount;
    assert.equal((await request('/api/import', { name: '../secret', version: '1' })).status, 400);
    assert.equal((await request('/api/import', { name: 'sample', version: '../1' })).status, 400);
    assert.equal((await request('/api/import', { name: 'sample', version: '1.2.0' }, { Origin: 'https://other.test' })).status, 403);
    assert.equal(outboundCount, before);
    assert.equal((await request('/api/import', { name: 'missing', version: '1' })).status, 404);
    assert.equal((await request('/api/import', { name: 'broken', version: '1.0' })).status, 422);
    assert.equal((await request('/api/import', { name: 'huge', version: '1.0' })).status, 413);
    assert.equal((await request('/api/import', { name: 'redirect', version: '1.0' })).status, 502);
    assert.equal((await request('/api/import', { name: 'mismatch', version: '1.0' })).status, 422);
    assert.equal((await request('/api/packages/sample/9')).status, 404);
    assert.equal((await request('/api/readme/sample/9')).status, 404);
    assert.equal((await request('/api/changelog/missing/1')).status, 404);
    assert.equal((await request('/api/readme/sample/invalid')).status, 400);
    assert.equal((await request('/api/packages?offset=-1')).status, 400);
    assert.ok(outboundUrls.every(url => new URL(url).hostname === 'hackage.haskell.org'));
    const count = await db.prepare('SELECT COUNT(*) AS count FROM releases').first();
    assert.equal(count.count, 2);
    for (let n = 0; n < 10; n++) {
      assert.equal((await request('/api/import', { name: '../secret', version: '1' }, { 'CF-Connecting-IP': '198.51.100.1' })).status, 400);
    }
    assert.equal((await request('/api/import', { name: 'sample', version: '1.2.0' }, { 'CF-Connecting-IP': '198.51.100.1' })).status, 429);
    // The Worker renders the home page, the search page, and the package pages.
    const pageOf = async (path, options) => {
      const response = await mf.dispatchFetch(`http://localhost${path}`, options);
      return { status: response.status, headers: response.headers, text: await response.text() };
    };
    const home = await pageOf('/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /^text\/html/);
    assert.equal(home.headers.get('cache-control'), 'public, max-age=60');
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(home.text, /<title>AIHC Hackage · Haskell packages<\/title>/);
    assert.match(home.text, /<link rel="canonical" href="http:\/\/localhost\/">/);
    assert.match(home.text, /href="\/package\/sample\/1.10.0"/);
    const results = await pageOf('/search?q=sample');
    assert.match(results.text, /<meta name="robots" content="noindex">/);
    assert.match(results.text, /Results for <span class="query">sample<\/span>/);
    assert.match(results.text, /class="package-name">sample</);
    assert.match(results.text, /value="sample"/);
    assert.match((await pageOf('/search?q=<nothing>')).text, /No imported package matches\.[\s\S]*data-import-name=""/);
    assert.match((await pageOf('/search?q=nothing')).text, /data-import-name="nothing"/);
    const readmePage = await pageOf('/package/sample/1.2.0/readme');
    assert.equal(readmePage.status, 200);
    assert.match(readmePage.text, /<title>sample-1.2.0 · AIHC Hackage<\/title>/);
    assert.match(readmePage.text, /<meta name="description" content="Revised catalogue entry">/);
    assert.match(readmePage.text, /<meta property="og:title" content="sample-1.2.0">/);
    assert.match(readmePage.text, /<link rel="canonical" href="http:\/\/localhost\/package\/sample\/1.2.0">/);
    assert.match(readmePage.text, /<a href="\/package\/sample\/1.2.0\/readme" data-tab="readme" aria-current="page">/);
    assert.match(readmePage.text, /<h2>Sample<\/h2>/);
    assert.match(readmePage.text, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/);
    assert.doesNotMatch(readmePage.text, /<script>alert/);
    assert.match(readmePage.text, /λ/);
    const description = await pageOf('/package/sample/1.2.0/description');
    assert.match(description.text, /<link rel="canonical" href="http:\/\/localhost\/package\/sample\/1.2.0\/description">/);
    assert.match(description.text, /<div class="prose"><p>Sample metadata with Unicode λ\.<\/p><\/div>/);
    const dependencies = await pageOf('/package/sample/1.2.0/dependencies');
    assert.match(dependencies.text, /<a href="\/package\/containers">containers<\/a>/);
    assert.match(dependencies.text, /<code class="condition">flag\(extra\)<\/code>/);
    assert.match((await pageOf('/package/containers')).text, /Import containers from Hackage/);
    assert.match((await pageOf('/package/sample/1.2.0/changelog')).text, /<pre class="package-document"># Changes\n\n\* Add a sample module\.\n<\/pre>/);
    const latest = await pageOf('/package/sample');
    assert.match(latest.text, /<link rel="canonical" href="http:\/\/localhost\/package\/sample\/1.10.0">/);
    assert.match(latest.text, /The document is not available\./);
    assert.match(latest.text, /<a href="\/package\/sample\/1.2.0">1.2.0<\/a>/);
    const dependents = await pageOf('/package/containers/0.6/dependents');
    assert.equal(dependents.status, 404);
    const missing = await pageOf('/package/nothing');
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.match(missing.text, /<meta name="robots" content="noindex">/);
    assert.match(missing.text, /data-import-name="nothing" data-import-version="">Import nothing from Hackage<\/button>/);
    assert.match((await pageOf('/package/sample/9')).text, /This package version has not been imported\./);
    assert.equal((await pageOf('/package/bad%20name/1')).status, 400);
    assert.equal((await pageOf('/package/sample/1.2.0/unknown')).status, 404);
    assert.equal((await pageOf('/search?offset=-1')).status, 400);
    assert.equal((await pageOf('/package/sample', { method: 'POST' })).status, 405);
    assert.equal((await pageOf('/missing')).status, 404);
    const map = await pageOf('/sitemap.xml');
    assert.match(map.headers.get('content-type'), /^application\/xml/);
    assert.match(map.text, /<loc>http:\/\/localhost\/package\/sample\/1.2.0<\/loc>/);
    assert.match(map.text, /<loc>http:\/\/localhost\/package\/sample\/1.10.0<\/loc>/);
    assert.match((await pageOf('/robots.txt')).text, /Sitemap: http:\/\/localhost\/sitemap.xml/);
  } finally { await mf.dispose(); }
});
