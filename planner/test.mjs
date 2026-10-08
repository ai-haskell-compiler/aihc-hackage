import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { instantiate } from '../generated/planner/planner.js';
import { runPlanner } from '../src/planner-runtime.js';

const modules = Object.fromEntries(await Promise.all((await readdir('generated/planner')).filter(name => name.endsWith('.wasm'))
  .map(async name => [name, await WebAssembly.compile(await readFile(`generated/planner/${name}`))])));
export async function solve(state) {
  return runPlanner(instantiate, path => modules[path], state);
}
test('The Wasm planner requests missing inputs and resolves revisions, flags, version ranges, and Linux conditions.', async () => {
  const state = JSON.parse(await readFile('generated/planner/core.json', 'utf8'));
  state.name = 'docs-root'; state.version = '1.0';
  assert.deepEqual((await solve(state)).need, { kind: 'versions', name: 'docs-root', version: '' });
  state.versions['docs-root'] = { '1.0': 'normal' };
  assert.deepEqual((await solve(state)).need, { kind: 'cabal', name: 'docs-root', version: '1.0' });
  const cabal = (name, version, dependencies) => `cabal-version: 2.4\nname: ${name}\nversion: ${version}\nlicense: BSD-3-Clause\nbuild-type: Simple\nlibrary\n  exposed-modules: Sample\n  build-depends: ${dependencies}\n  default-language: Haskell2010\n`;
  const root = cabal('docs-root', '1.0', 'base >=4.0 && <5').replace('library', 'flag extra\n  default: True\n  manual: False\nlibrary')
    + '  if os(linux) && flag(extra)\n    build-depends: docs-dep >=1 && <2\n  else\n    build-depends: missing-package ==1\n';
  state.descriptions['docs-root-1.0'] = { cabal: root, revision: 1 };
  state.versions['docs-dep'] = { '1.0': 'normal', '2.0': 'normal' };
  state.descriptions['docs-dep-1.0'] = { cabal: cabal('docs-dep', '1.0', 'aihc-prim'), revision: 0 };
  const plan = await solve(state);
  assert.ok(plan.packages, JSON.stringify(plan));
  const selected = plan.packages.find(pkg => pkg.name === 'docs-root');
  assert.equal(selected.revision, 1); assert.equal(selected.flags.extra, true);
  assert.equal(plan.packages.find(pkg => pkg.name === 'docs-dep').version, '1.0');
  assert.ok(plan.packages.some(pkg => pkg.name === 'aihc-base' && pkg.source === 'core'));
  assert.ok(selected.dependencies.includes('docs-dep'));
  assert.ok(selected.dependencies.includes('aihc-prim'));
});
