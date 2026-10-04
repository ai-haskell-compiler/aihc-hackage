import { bytesText } from './codec.js';

export function unpackTar(bytes, fs) {
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    const string = (start, end) => bytesText(header.subarray(start, end)).split('\0')[0];
    const name = string(0, 100).replace(/^\.\//, '');
    if (!name) break;
    const size = parseInt(string(124, 136).trim(), 8) || 0;
    if (offset + 512 + size > bytes.length || name.split('/').includes('..')) throw new Error('The system archive is invalid.');
    const path = `/usr/${name}`.replace(/\/$/, '');
    if (header[156] === 53) fs.mkdir(path, true, true);
    else if (header[156] === 48 || header[156] === 0) {
      fs.mkdir(path.slice(0, path.lastIndexOf('/')), true, true);
      fs.write(path, bytes.subarray(offset + 512, offset + 512 + size), false, true);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
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
