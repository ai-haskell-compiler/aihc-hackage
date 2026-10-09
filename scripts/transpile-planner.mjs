import { externalizeWasm } from './externalize-wasm.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { transpileBytes } from '@bytecodealliance/jco-transpile';
const component = await readFile('planner.wasm');
const result = await transpileBytes(component, {
  name: 'planner', instantiation: 'async', wasiShim: false,
  nodejsCompat: false, base64Cutoff: 0,
});
externalizeWasm(result.files, 'planner');
await mkdir('generated/planner', { recursive: true });
for (const [name, bytes] of Object.entries(result.files)) {
  const path = `generated/planner/${name}`;
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, bytes);
}
const modules = Object.keys(result.files).filter(name => name.endsWith('.wasm')).sort();
await writeFile('generated/planner/core-modules.js',
  modules.map((name, index) => `import core${index} from './${name}';`).join('\n') +
  `\nconst modules = {${modules.map((name, index) => `${JSON.stringify(name)}: core${index}`).join(',')}};\n` +
  `export const getCoreModule = path => modules[path];\n`);
console.log(`Transpiled planner into ${modules.length} core Wasm modules.`);

// Core Cabal files are build inputs from the pinned compiler source.
const { readdir } = await import('node:fs/promises');
const root = process.env.AIHC_HADDOCK_ROOT || '.compiler-haddock';
const core = { versions: {}, descriptions: {} };
for (const name of await readdir(`${root}/core-libs`)) {
  let cabal;
  try { cabal = await readFile(`${root}/core-libs/${name}/${name}.cabal`, 'utf8'); } catch { continue; }
  const version = /^version:\s*(\S+)/mi.exec(cabal)?.[1];
  if (!version) throw new Error(`The core library has no version: ${name}`);
  core.versions[name] = { [version]: 'normal' };
  core.descriptions[`${name}-${version}`] = { cabal, revision: 0, core: true };
}
await writeFile('generated/planner/core.json', JSON.stringify(core));
