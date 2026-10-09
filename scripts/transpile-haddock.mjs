import { externalizeWasm } from './externalize-wasm.mjs';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { transpileBytes } from '@bytecodealliance/jco-transpile';

// The shell loads these files when a visitor first runs aihc-haddock.
// The transpiled JavaScript goes to generated/haddock, and shell/haddock-worker.js imports it.
const component = await readFile('haddock.wasm');
const result = await transpileBytes(component, {
  name: 'haddock', instantiation: 'async', wasiShim: false,
  nodejsCompat: false, base64Cutoff: 0,
});
externalizeWasm(result.files, 'haddock');
await mkdir('generated/haddock', { recursive: true });
await mkdir('public/shell/haddock', { recursive: true });
const modules = [];
for (const [name, bytes] of Object.entries(result.files)) {
  if (name.endsWith('.d.ts') || name.startsWith('interfaces/')) continue;
  await writeFile(`generated/haddock/${name}`, bytes);
  if (name.endsWith('.wasm')) {
    modules.push(name);
    await writeFile(`public/shell/haddock/${name}.gz`, gzipSync(bytes, { level: 9 }));
  }
}
await writeFile('generated/haddock/core-modules.js',
  modules.map((name, index) => `import core${index} from './${name}';`).join('\n') +
  `\nconst modules = {${modules.map((name, index) => `${JSON.stringify(name)}: core${index}`).join(',')}};\n` +
  `export const getCoreModule = path => modules[path];\n`);
await writeFile('generated/haddock/modules.json', JSON.stringify(modules.sort()));
await writeFile('public/shell/haddock/modules.json', JSON.stringify(modules));

// The package planner needs the sources of the AIHC core libraries.
// The component has no environment access, so the shell mounts them at /core-libs.
const root = process.env.AIHC_HADDOCK_ROOT || '.compiler-haddock';
const entries = [];
async function visit(directory, relative) {
  for (const name of (await readdir(join(root, directory))).sort()) {
    const path = join(directory, name);
    const target = `${relative}/${name}`;
    const info = await stat(join(root, path));
    if (info.isDirectory()) { entries.push({ path: `${target}/`, bytes: new Uint8Array() }); await visit(path, target); }
    else if (/\.(hs|hs-boot|hsc|cabal|h|c|lir|systemfc|md|txt)$|(^|\/)LICENSE$/.test(name)) {
      entries.push({ path: target, bytes: await readFile(join(root, path)) });
    }
  }
}
await visit('core-libs', 'core-libs');
function ustar(files) {
  const blocks = [];
  for (const { path, bytes } of files) {
    const header = new Uint8Array(512);
    const put = (text, offset) => header.set(new TextEncoder().encode(text), offset);
    if (path.length > 100) throw new Error(`The archive path is too long: ${path}`);
    const directory = path.endsWith('/');
    put(path, 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116);
    put(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124); put('00000000000\0', 136);
    put('        ', 148); header[156] = directory ? 53 : 48; put('ustar\0', 257); put('00', 263);
    put(`${header.reduce((sum, value) => sum + value, 0).toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, bytes, new Uint8Array((512 - bytes.length % 512) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return Buffer.concat(blocks);
}
// Node writes no timestamp, so the same sources give the same archive.
const archive = gzipSync(ustar(entries), { level: 9 });
await writeFile('public/shell/haddock/core-libs.tar.gz', archive);
console.log(`Transpiled aihc-haddock into ${modules.length} core Wasm modules and ${entries.length} core library entries.`);
