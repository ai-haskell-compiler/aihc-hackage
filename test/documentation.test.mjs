import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { GENERATOR, MAX_MODEL, canonical, digest, encode, validateModel, validatePlan } from '../documentation/contract.js';
import { sourceEntries, decompress } from '../documentation/archive.js';
import { previewHtml } from '../documentation/render.js';
import { tar, fixturePlan, fixtureModel } from './helpers/documentation.mjs';
import { buildDocumentation } from '../builder/runner.js';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';

test('Source archives reject traversal, links, duplicate entries, and decompression overflow.', async () => {
  assert.equal(sourceEntries(tar([['pkg-1.0/src/A.hs', 'module A where']]), 'pkg-1.0')[0].path, 'src/A.hs');
  for (const path of ['pkg-1.0/../x', '/pkg-1.0/x', 'other-1.0/x', 'pkg-1.0/a\\b', 'pkg-1.0//x']) {
    assert.throws(() => sourceEntries(tar([[path, 'x']]), 'pkg-1.0'), /unsafe/);
  }
  assert.throws(() => sourceEntries(tar([['pkg-1.0/x', 'x']], { type: 50 }), 'pkg-1.0'), /unsupported/);
  assert.throws(() => sourceEntries(tar([['pkg-1.0/x', 'x'], ['pkg-1.0/x', 'y']]), 'pkg-1.0'), /duplicate/);
  const corrupt = tar([['pkg-1.0/x', 'x']]); corrupt[1] ^= 1;
  assert.throws(() => sourceEntries(corrupt, 'pkg-1.0'), /checksum/);
  await assert.rejects(decompress(gzipSync(Buffer.alloc(10000)), 100), /size limit/);
});

test('Plans and models reject cycles, wrong identities, and deep document trees.', async () => {
  const { plan } = await fixturePlan(); validatePlan(plan);
  const cycle = structuredClone(plan); cycle.packages[0].dependencies.push(plan.root.name);
  assert.throws(() => validatePlan(cycle), /circular/);
  const model = fixtureModel(plan); validateModel(model, plan);
  assert.throws(() => validateModel({ ...model, name: 'other' }, plan), /match/);
  let doc = { tag: 'DocString', string: 'x' };
  for (let i = 0; i < 50; i++) doc = { tag: 'DocParagraph', document: doc };
  model.modules[0].description = doc;
  assert.throws(() => validateModel(model, plan), /structure/);
});

test('The documentation renderer escapes markup and honors export lists.', async () => {
  const { plan } = await fixturePlan(); const html = previewHtml(fixtureModel(plan));
  assert.match(html, /&lt;script&gt;/); assert.match(html, /greet/);
  assert.doesNotMatch(html, /javascript:|privateValue|<script>/);
  const model = fixtureModel(plan);
  model.modules[0].exports.unshift({ tag: 'section_item', contents: [1, { tag: 'DocAppend',
    first: { tag: 'DocString', string: 'Section title\n\nSection text.' }, second: { tag: 'DocString', string: ' More text.' } }] });
  assert.match(previewHtml(model), /<h2>Section title<\/h2><div class="prose">\nSection text\. More text\.<\/div>/);
  model.modules[0].exports.push(...Array(1000).fill(model.modules[0].exports[1]));
  assert.equal((previewHtml(model).match(/id="decl-value-greet"/g) || []).length, 1);
  model.modules[0].decls[0].name = '\ud800';
  assert.throws(() => validateModel(model, plan), /Unicode/);
});

test('Cloudflare Workflows plan, cache sources, accept uploads, and verify exact browser output without a runner token.', { timeout: 120000 }, async () => {
  const fixture = await fixturePlan(); const paths = [];
  const rootCabal = fixture.cabal.replace('synopsis:', 'x-revision: 1\nsynopsis:').replace('build-depends: base', 'build-depends: base, docs-dep >=1 && <2');
  const rootSha = await digest(encode(rootCabal));
  const depCabal = 'cabal-version: 2.4\nname: docs-dep\nversion: 1.0\nlibrary\n  exposed-modules: Dep\n  build-depends: base\n';
  const depArchive = gzipSync(tar([['docs-dep-1.0/docs-dep.cabal', depCabal], ['docs-dep-1.0/Dep.hs', 'module Dep where\nx :: Bool\nx = True\n']]));
  const outbound = async request => {
    const path = new URL(request.url).pathname; paths.push(path);
    assert.equal(new URL(request.url).hostname, 'hackage.haskell.org');
    if (path === '/package/docs-sample.json') return Response.json({ '0.1.0.0': 'normal' });
    if (path === '/package/docs-dep.json') return Response.json({ '1.0': 'normal', '2.0': 'normal' });
    if (path === '/package/docs-dep-1.0/docs-dep.cabal') return new Response(depCabal);
    if (path === '/package/docs-dep-1.0/docs-dep-1.0.tar.gz') return new Response(depArchive);
    if (path === '/package/docs-sample-0.1.0.0/docs-sample-0.1.0.0.tar.gz') return new Response(fixture.files.get(fixture.plan.packages[0].archiveSha256));
    return new Response(null, { status: 404 });
  };
  const modules = async directory => [{ type: 'ESModule', path: `${directory}/${directory === 'dist' ? 'worker' : 'documentation-workflow'}.js` },
    ...(await readdir(directory)).filter(name => name.endsWith('.wasm')).map(name => ({ type: 'CompiledWasm', path: `${directory}/${name}` }))];
  const shared = { compatibilityDate: '2026-10-03', compatibilityFlags: ['nodejs_compat'], d1Databases: { DB: 'docs-db' }, r2Buckets: { CABAL: 'docs-bucket' } };
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'site', ...shared, modulesRoot: 'dist', modules: await modules('dist'),
      ratelimits: { DOC_LIMIT: { namespace_id: '1002', simple: { limit: 20, period: 60 } } },
      workflows: { DOC_WORKFLOW: { name: 'aihc-documentation', className: 'DocumentationWorkflow', scriptName: 'aihc-documentation' } } },
    { name: 'aihc-documentation', ...shared, modulesRoot: 'dist-docs', modules: await modules('dist-docs'),
      workflows: { DOC_WORKFLOW: { name: 'aihc-documentation', className: 'DocumentationWorkflow' } },
      assets: { directory: 'public', binding: 'ASSETS', routerConfig: { has_user_worker: true } }, outboundService: outbound },
  ] }));
  try {
    const db = await mf.getD1Database('DB', 'site'); const bucket = await mf.getR2Bucket('CABAL', 'site');
    for (const name of (await readdir('migrations')).filter(name => name.endsWith('.sql')).sort()) await db.exec((await readFile(`migrations/${name}`, 'utf8')).replaceAll('\n', ' '));
    await bucket.put('root-cabal', rootCabal);
    await db.prepare(`INSERT INTO releases (name,version,version_sort,synopsis,description,license,modules,metadata_key,cabal_key,sha256,imported_at)
      VALUES ('docs-sample','0.1.0.0','0001','','','','','','root-cabal',?,'2026-10-08')`).bind(rootSha).run();
    let ip = 0;
    const request = (path, body, { method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) =>
      mf.dispatchFetch(`http://localhost/api/docs${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `test-${ip++}`, ...headers },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    assert.equal((await request('/plans', 'null')).status, 400);
    assert.equal((await request('/plans', { name: 'missing', version: '1.0' })).status, 404);
    assert.equal((await request('/plans', fixture.plan.root, { headers: { Origin: 'https://other.test' } })).status, 403);
    for (const route of ['/runner/claim', '/runner/verify']) assert.equal((await request(route, {})).status, 404);
    const started = await request('/plans', fixture.plan.root); const job = await started.json();
    assert.ok(started.ok, JSON.stringify(job));
    assert.equal((await (await request('/plans', fixture.plan.root)).json()).id, job.id);
    let ready;
    for (let i = 0; i < 300; i++) {
      ready = await (await request(`/jobs/${job.id}`)).json();
      if (ready.state === 'ready' || ready.state === 'failed') break;
      await delay(100);
    }
    assert.equal(ready.state, 'ready', JSON.stringify(ready));
    const plan = ready.plan; const planId = plan.id;
    assert.equal(plan.root.cabalSha256, rootSha);
    assert.equal(plan.packages.find(pkg => pkg.name === 'docs-sample').revision, 1);
    assert.equal(plan.packages.find(pkg => pkg.name === 'docs-dep').version, '1.0');
    assert.ok(plan.packages.some(pkg => pkg.name === 'aihc-base' && pkg.source === 'core'));
    assert.equal((await db.prepare('SELECT count(*) AS n FROM releases').first()).n, 1);
    assert.equal(paths.filter(path => path.includes('01-index')).length, 0);
    const download = async (url, hash) => url.startsWith('/builder/') ? new Uint8Array(await readFile(`public${url}`))
      : new Uint8Array(await (await request(`/objects/${hash}`)).arrayBuffer());
    const runtime = JSON.parse(await readFile('public/builder/runtime.json', 'utf8'));
    const built = await buildDocumentation(plan, { runtime, download });
    const modelSha256 = await digest(encode(built.modelText));
    const tickets = await Promise.all([0, 1].map(async () => (await request('/uploads', { planId, modelSha256 })).json()));
    const headers = ticket => ({ Authorization: `Bearer ${ticket.token}` });
    assert.equal((await request(`/uploads/${tickets[0].id}`, built.modelText, { method: 'PUT' })).status, 403);
    assert.equal((await request(`/uploads/${tickets[0].id}`, ' '.repeat(MAX_MODEL + 1), { method: 'PUT', headers: headers(tickets[0]) })).status, 413);
    const responses = await Promise.all(tickets.map(ticket => request(`/uploads/${ticket.id}`, built.modelText, { method: 'PUT', headers: headers(ticket) })));
    const result = await responses[0].json(); assert.equal(responses[0].status, 201, JSON.stringify(result));
    assert.equal((await responses[1].json()).id, result.id);
    assert.equal((await request(`/uploads/${tickets[0].id}`, built.modelText, { method: 'PUT', headers: headers(tickets[0]) })).status, 200);
    let record;
    for (let i = 0; i < 300; i++) {
      record = await (await request(`/results/${result.id}`)).json();
      if (record.provenance === 'verified') break;
      await delay(100);
    }
    assert.equal(record.provenance, 'verified', JSON.stringify(record).slice(0,1000));
    const different = JSON.stringify({ ...built.model, modules: [] }); const differentHash = await digest(encode(different));
    const expired = await (await request('/uploads', { planId, modelSha256: differentHash })).json();
    await db.prepare('UPDATE documentation_uploads SET expires_at=0 WHERE id=?').bind(expired.id).run();
    assert.equal((await request(`/uploads/${expired.id}`, different, { method: 'PUT', headers: headers(expired) })).status, 410);
    const later = await (await request('/uploads', { planId, modelSha256: differentHash })).json();
    const laterResult = await (await request(`/uploads/${later.id}`, different, { method: 'PUT', headers: headers(later) })).json();
    assert.notEqual(laterResult.id, result.id);
    assert.equal((await (await request(`/jobs/${job.id}`)).json()).result.id, result.id);
    assert.equal((await mf.dispatchFetch(`http://localhost/docs/${result.id}/Missing.Module`)).status, 404);
    const page = await mf.dispatchFetch(`http://localhost/docs/${result.id}/Docs.Sample`); const html = await page.text();
    assert.equal(page.status, 200); assert.match(html, /Verified build/);
    const builder = await mf.dispatchFetch('http://localhost/build');
    assert.match(builder.headers.get('content-security-policy'), /wasm-unsafe-eval/);
    assert.match(await builder.text(), /builder\/assets\/app.js/);
  } finally { await mf.dispose(); }
});
