import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instantiate } from '../generated/parser.js';
import { execute } from '../src/wasi-host.js';
const getCoreModule = async path => WebAssembly.compile(await readFile(new URL(`../generated/${path}`, import.meta.url)));
async function parse(name) {
  const input = await readFile(new URL(`fixtures/${name}`, import.meta.url));
  const result = await execute(instantiate, getCoreModule, input);
  assert.equal(result.stderr.length, 0);
  return JSON.parse(new TextDecoder().decode(result.stdout));
}
test('The Wasm parser preserves package fields and conditional branches.', async () => {
  const result = await parse('sample.cabal');
  assert.equal(result.name, 'sample');
  assert.equal(result.version, '1.2.0');
  assert.deepEqual(result.fields.license, ['BSD-3-Clause']);
  assert.deepEqual(result.fields.description, ['Sample metadata with Unicode λ.']);
  const tree = result.components[0].tree;
  assert.deepEqual(tree.data.exposedModules, ['Sample.Main']);
  assert.equal(tree.data.dependencies[0].range, '>=4.16 && <5');
  assert.deepEqual(tree.branches[0].condition, { flag: 'extra' });
  assert.deepEqual(tree.branches[0].then.data.exposedModules, ['Sample.Extra']);
  assert.equal(tree.branches[0].else.data.dependencies[0].package, 'bytestring');
});
test('The Wasm parser reports invalid Cabal source as JSON.', async () => {
  assert.match((await parse('invalid.cabal')).error, /.+/);
});
test('Concurrent parser calls keep their input and output separate.', async () => {
  const results = await Promise.all([parse('sample.cabal'), parse('invalid.cabal'), parse('sample.cabal')]);
  assert.equal(results[0].name, 'sample'); assert.ok(results[1].error); assert.equal(results[2].name, 'sample');
});

test('The Wasm parser reads the published text Cabal file.', async () => {
  const result = await parse('text-2.1.4.cabal');
  assert.equal(result.name, 'text');
  assert.equal(result.version, '2.1.4');
  assert.equal(result.fields.license[0], 'BSD-2-Clause');
  assert.ok(result.components.some(c => c.tree.data.exposedModules.includes('Data.Text')));
});

test('The Wasm parser preserves source across stdin buffer limits.', async () => {
  const result = await parse('large-source.cabal');
  assert.equal(result.name, 'large-source');
  assert.equal(result.fields.description[0], 'abcλ'.repeat(20000));
  assert.deepEqual(result.components[0].tree.data.exposedModules, ['Large.Source']);
});
