import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { transpileBytes } from '@bytecodealliance/jco-transpile';
const component = await readFile('parser.wasm');
const result = await transpileBytes(component, {
  name: 'parser', instantiation: 'async', wasiShim: false,
  nodejsCompat: false, base64Cutoff: 0,
});
await mkdir('generated', { recursive: true });
for (const [name, bytes] of Object.entries(result.files)) {
  const path = `generated/${name}`;
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, bytes);
}
const modules = Object.keys(result.files).filter(name => name.endsWith('.wasm')).sort();
await writeFile('generated/core-modules.js',
  modules.map((name, index) => `import core${index} from './${name}';`).join('\n') +
  `\nconst modules = {${modules.map((name, index) => `${JSON.stringify(name)}: core${index}`).join(',')}};\n` +
  `export const getCoreModule = path => modules[path];\n`);
console.log(`Transpiled parser into ${modules.length} core Wasm modules.`);
