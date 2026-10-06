import { readTar } from './tar.js';

export function unpackTar(bytes, fs) {
  let entries;
  try { entries = readTar(bytes); } catch { throw new Error('The system archive is invalid.'); }
  for (const entry of entries) {
    const path = `/usr/${entry.path}`;
    if (entry.kind === 'directory') fs.mkdir(path, true, true);
    else {
      fs.mkdir(path.slice(0, path.lastIndexOf('/')), true, true);
      fs.write(path, entry.bytes, false, true);
    }
  }
}
export async function loadToolchain(fs, status) {
  const load = async name => {
    const response = await fetch(`/shell/toolchain/${name}.gz`);
    if (!response.ok) throw new Error('The C toolchain could not be loaded.');
    return new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  };
  status('Loading the C toolchain…');
  const [clang, lld, sysroot] = await Promise.all(['clang', 'lld', 'sysroot.tar'].map(load));
  const modules = await Promise.all([clang, lld].map(bytes => WebAssembly.compile(bytes)));
  unpackTar(sysroot, fs);
  fs.write('/bin/clang', clang, false, true); fs.write('/bin/wasm-ld', lld, false, true);
  status('C toolchain ready');
  return modules;
}
