import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const source = await readFile(new URL('fixtures/sample.cabal', import.meta.url), 'utf8');
const invalid = await readFile(new URL('fixtures/invalid.cabal', import.meta.url), 'utf8');
let revision = source;
let outboundCount = 0;
const mf = new Miniflare(convertV4MiniflareOptions({
  modulesRoot: 'dist', modules: [{ type: 'ESModule', path: 'dist/worker.js' },
    ...(await readdir('dist')).filter(name => name.endsWith('.wasm')).map(name => ({ type: 'CompiledWasm', path: `dist/${name}` }))],
  compatibilityDate: '2026-10-03', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'], r2Buckets: ['CABAL'], ratelimits: { IMPORT_LIMIT: { namespace_id: '1001', simple: { limit: 10, period: 60 } } },
  outboundService: async request => {
    outboundCount++;
    assert.equal(new URL(request.url).hostname, 'hackage.haskell.org');
    const path = new URL(request.url).pathname;
    if (path === '/package/sample-1.2.0/sample.cabal') return new Response(revision);
    if (path === '/package/sample-1.10.0/sample.cabal') return new Response(source.replace('version: 1.2.0', 'version: 1.10.0'));
    if (path === '/package/broken-1.0/broken.cabal') return new Response(invalid);
    if (path === '/package/huge-1.0/huge.cabal') return new Response('a'.repeat(1048577));
    if (path === '/package/redirect-1.0/redirect.cabal') return new Response('', { status: 302, headers: { Location: 'https://other.test' } });
    if (path === '/package/mismatch-1.0/mismatch.cabal') return new Response(source);
    return new Response('Missing', { status: 404 });
  },
}));
const db = await mf.getD1Database('DB');
const migration = await readFile('migrations/0001_packages.sql', 'utf8');
await db.exec(migration.replaceAll('\n', ' '));
let address = 1;
async function request(path, body, extraHeaders = {}) {
  const response = await mf.dispatchFetch(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${address++}`, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
test('The Worker imports Cabal source into R2 and D1.', async () => {
  try {
    assert.equal((await request('/api/packages')).data.packages.length, 0);
    assert.equal((await request('/api/import', { name: 'sample', version: '1.2.0' })).status, 201);
    const detail = await request('/api/packages/sample');
    assert.equal(detail.data.version, '1.2.0');
    assert.deepEqual(detail.data.exposedModules, ['Sample.Main', 'Sample.Extra']);
    assert.equal(detail.data.dependencies.length, 3);
    assert.equal(detail.data.fields.license[0], 'BSD-3-Clause');
    assert.equal((await request('/api/packages?q=Sample.Main')).data.packages[0].name, 'sample');
    assert.equal((await request('/api/packages?q=small')).data.packages.length, 1);
    const reverse = await request('/api/reverse/text');
    assert.equal(reverse.data.dependencies[0].name, 'sample');
    assert.deepEqual(JSON.parse(reverse.data.dependencies[0].condition), [{ flag: 'extra' }]);
    const raw = await mf.dispatchFetch('http://localhost/api/cabal/sample/1.2.0');
    assert.equal(await raw.text(), source);
    // The revised fixture must replace the search and dependency indexes.
    revision = source.replace('A small package', 'Revised catalogue entry').replace('text >=2', 'containers >=0.6');
    assert.equal((await request('/api/import', { name: 'sample', version: '1.2.0' })).status, 201);
    assert.equal((await request('/api/reverse/text')).data.dependencies.length, 0);
    assert.equal((await request('/api/reverse/containers')).data.dependencies.length, 1);
    assert.equal((await request('/api/packages?q=small')).data.packages.length, 0);
    assert.equal((await request('/api/packages?q=Revised')).data.packages.length, 1);
    assert.equal((await request('/api/import', { name: 'sample', version: '1.10.0' })).status, 201);
    assert.equal((await request('/api/packages/sample')).data.version, '1.10.0');
    assert.deepEqual((await request('/api/packages/sample')).data.versions.map(v => v.version), ['1.10.0', '1.2.0']);
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
    assert.equal((await request('/api/packages?offset=-1')).status, 400);
    const count = await db.prepare('SELECT COUNT(*) AS count FROM releases').first();
    assert.equal(count.count, 2);
    for (let n = 0; n < 10; n++) {
      assert.equal((await request('/api/import', { name: '../secret', version: '1' }, { 'CF-Connecting-IP': '198.51.100.1' })).status, 400);
    }
    assert.equal((await request('/api/import', { name: 'sample', version: '1.2.0' }, { 'CF-Connecting-IP': '198.51.100.1' })).status, 429);
  } finally { await mf.dispose(); }
});
