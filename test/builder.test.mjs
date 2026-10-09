import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDocumentation } from '../builder/runner.js';
import { fixturePlan, reexportPlan } from './helpers/documentation.mjs';
import { previewHtml } from '../documentation/render.js';
import { canonical, digest, encode } from '../documentation/contract.js';

test('The browser generator uses the planned Cabal revision, flags, and target without solving.', async () => {
  const { plan, files } = await fixturePlan();
  const id = await digest(encode(canonical(plan)));
  const runtime = JSON.parse(await readFile('public/builder/runtime.json', 'utf8'));
  const stages = [];
  const result = await buildDocumentation({ id, ...plan }, { runtime, progress: event => stages.push(event.stage),
    download: async (url, hash) => files.get(hash) || new Uint8Array(await readFile(`public${url}`)) });
  assert.deepEqual(result.model.modules.map(mod => mod.name).sort(), ['Docs.Extra', 'Docs.Linux', 'Docs.Sample']);
  assert.match(result.hoogle, /greet :: String -> String/);
  assert.ok(stages.includes('generate'));
  await assert.rejects(buildDocumentation({ ...plan, id: '0'.repeat(64) }, { runtime }), /checksum/);
});

test('The browser generator resolves hidden modules and dependency re-exports.', async () => {
  const { plan, files } = await reexportPlan();
  const runtime = JSON.parse(await readFile('public/builder/runtime.json', 'utf8'));
  const result = await buildDocumentation(plan, { runtime,
    download: async (url, hash) => files.get(hash) || new Uint8Array(await readFile(`public${url}`)) });
  assert.equal(result.model.format_version, 2);
  const mod = result.model.modules.find(mod => mod.name === 'Public');
  assert.equal(mod.decls.length, 0);
  const declarations = mod.resolved_exports.filter(item => item.tag === 'resolved_item').map(item => item.contents);
  assert.deepEqual(declarations.map(decl => decl.name), ['localValue', 'fromDep']);
  assert.equal(declarations[1].identity.package, 'docs-leaf-1.0');
  assert.ok(mod.resolved_exports.some(item => item.tag === 'resolved_module_item'));
  const html = previewHtml(result.model, 'Public');
  assert.match(html, /A value from a hidden module\./);
  assert.match(html, /A value from a dependency\./);
  assert.equal((html.match(/id="decl-value-fromDep"/g) || []).length, 1);
  assert.match(result.hoogle, /fromDep :: Int/);
});
