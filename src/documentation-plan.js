import { GENERATOR, TARGET, NAME, VERSION, MAX_SOURCE, canonical, digest, encode, validatePlan } from '../documentation/contract.js';
import { limitedBytes } from './http.js';

const second = () => Math.floor(Date.now() / 1000);
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
export async function storeInput(env, kind, bytes) {
  const sha256 = await digest(bytes); const key = `documentation/objects/${sha256}`;
  await env.CABAL.put(key, bytes, { httpMetadata: { contentType: kind === 'source' ? 'application/gzip' : 'text/plain; charset=utf-8' } });
  await env.DB.prepare('INSERT INTO documentation_objects (sha256,kind,size,object_key) VALUES (?,?,?,?) ON CONFLICT(sha256) DO NOTHING')
    .bind(sha256, kind, bytes.length, key).run();
  return { sha256, size: bytes.length, key };
}
async function hackage(env, kind, name, version, fetcher) {
  if (!NAME.test(name) || (version && !VERSION.test(version))) throw new Error('The planner requested an invalid package.');
  const cacheKey = `${kind}:${name}:${version || ''}`;
  const cached = await env.DB.prepare('SELECT object_key,fetched_at FROM documentation_metadata WHERE id=?').bind(cacheKey).first();
  if (cached && (kind === 'source' || cached.fetched_at > second() - 3600)) {
    const object = await env.CABAL.get(cached.object_key);
    if (object) return new Uint8Array(await object.arrayBuffer());
  }
  const path = kind === 'versions' ? `/package/${name}.json` : kind === 'cabal' ? `/package/${name}-${version}/${name}.cabal`
    : `/package/${name}-${version}/${name}-${version}.tar.gz`;
  const response = await fetcher(`https://hackage.haskell.org${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Accept: kind === 'versions' ? 'application/json' : '*/*' } });
  let bytes;
  if (response.status === 404 && kind === 'versions') { await response.body?.cancel(); bytes = encode('{}'); }
  else {
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Hackage could not supply ${kind} for ${name}${version ? `-${version}` : ''}.`); }
    bytes = await limitedBytes(response, kind === 'source' ? MAX_SOURCE : 1024 * 1024);
  }
  const hash = await digest(bytes); const key = `documentation/metadata/${hash}`;
  await env.CABAL.put(key, bytes);
  await env.DB.prepare('INSERT INTO documentation_metadata (id,object_key,fetched_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET object_key=excluded.object_key,fetched_at=excluded.fetched_at')
    .bind(cacheKey, key, second()).run();
  return bytes;
}
export async function resolveDocumentationPlan(env, job, { solve, core, step, fetcher = fetch }) {
  const snapshots = [];
  const root = await step.do('root-cabal', async () => {
    const release = await env.DB.prepare('SELECT cabal_key FROM releases WHERE name=? AND version=? AND sha256=?').bind(job.name, job.version, job.cabal_sha256).first();
    const object = release && await env.CABAL.get(release.cabal_key);
    if (!object) throw new Error('The imported Cabal file changed. Start the build again.');
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await digest(bytes) !== job.cabal_sha256) throw new Error('The imported Cabal checksum is incorrect.');
    const key = `documentation/metadata/${job.cabal_sha256}`;
    await env.CABAL.put(key, bytes); return key;
  });
  const description = cabal => ({ cabal, revision: Number(/^x-revision:\s*(\d+)\s*$/mi.exec(cabal)?.[1] || 0), core: false });
  const loadState = async () => {
    const state = structuredClone(core); state.name = job.name; state.version = job.version;
    const rootObject = await env.CABAL.get(root);
    state.descriptions[`${job.name}-${job.version}`] = description(await rootObject.text());
    for (const snapshot of snapshots) {
      const object = await env.CABAL.get(snapshot.key);
      const text = await object.text();
      if (snapshot.kind === 'versions') state.versions[snapshot.name] = JSON.parse(text);
      else state.descriptions[`${snapshot.name}-${snapshot.version}`] = description(text);
    }
    if (encode(JSON.stringify(state)).length > 8 * 1024 * 1024) throw new Error('The solver inputs exceed the memory limit.');
    return state;
  };
  let solution;
  for (let index = 0; index < 768; index++) {
    const result = await step.do(`solve-${index}`, { retries: { limit: 0, delay: '1 second' }, timeout: '2 minutes' }, async () => solve(await loadState()));
    if (result.error) throw new Error(result.error);
    if (result.packages) { solution = result.packages; break; }
    const need = result.need;
    if (!need || !['versions', 'cabal'].includes(need.kind)) throw new Error('The solver returned an invalid input request.');
    const snapshot = await step.do(`input-${index}`, async () => {
      const bytes = await hackage(env, need.kind, need.name, need.version, fetcher);
      if (need.kind === 'versions') {
        const versions = JSON.parse(decode(bytes));
        if (!versions || Array.isArray(versions) || typeof versions !== 'object' || Object.keys(versions).length > 5000
          || Object.entries(versions).some(([version, status]) => !VERSION.test(version) || !['normal', 'deprecated', 'unpreferred'].includes(status))) throw new Error('Hackage returned an invalid version list.');
      }
      const sha256 = await digest(bytes); const key = `documentation/metadata/${sha256}`;
      await env.CABAL.put(key, bytes);
      return { kind: need.kind, name: need.name, version: need.version, sha256, key };
    });
    snapshots.push(snapshot);
  }
  if (!solution || solution.length > 256) throw new Error('The dependency plan exceeds the planning limit.');
  const packages = []; let totalSource = 0;
  for (const pkg of solution) {
    const stored = await step.do(`store-${pkg.name}`, async () => {
      const state = await loadState();
      const input = state.descriptions[`${pkg.name}-${pkg.version}`];
      if (!input) throw new Error('The solver selected a missing input.');
      const cabal = await storeInput(env, 'cabal', encode(input.cabal));
      if (pkg.source === 'core') return { cabalSha256: cabal.sha256 };
      const source = await storeInput(env, 'source', await hackage(env, 'source', pkg.name, pkg.version, fetcher));
      return { cabalSha256: cabal.sha256, archiveSha256: source.sha256, archiveSize: source.size };
    });
    totalSource += stored.archiveSize || 0;
    if (totalSource > 96 * 1024 * 1024) throw new Error('The plan exceeds the total download limit.');
    packages.push({ ...pkg, ...stored });
  }
  const resolvedAt = await step.do('resolved-at', async () => second());
  return validatePlan({ format: 1, generator: GENERATOR, target: TARGET, metadataSha256: await digest(encode(canonical({ snapshots, root: job.cabal_sha256 }))), resolvedAt,
    root: { name: job.name, version: job.version, cabalSha256: job.cabal_sha256 }, packages });
}
export async function startDocumentationWorkflow(env, id, params) {
  try { await env.DOC_WORKFLOW.create({ id, params }); }
  catch (error) {
    // A repeated request must use the existing instance without starting another build.
    try { await (await env.DOC_WORKFLOW.get(id)).status(); } catch { throw error; }
  }
}
