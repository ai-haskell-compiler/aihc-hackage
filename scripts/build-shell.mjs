import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const revision = '648c4a89997a351eef75cdaec3ef5b89d4937dec';
const files = {
  clang: '2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d',
  lld: '36419ed202011765222098d7701218378b67f634d50f0a4625059ae2c9860f48',
  'sysroot.tar': '2435a7b549af30c2be7ec249c405bc2e911ab0c6003012f0909ec3c131bff867',
};
await mkdir('public/shell/toolchain', { recursive: true });
await mkdir('public/shell/assets', { recursive: true });
for (const [name, digest] of Object.entries(files)) {
  const destination = `public/shell/toolchain/${name}.gz`;
  try {
    const cached = gunzipSync(await readFile(destination));
    if (createHash('sha256').update(cached).digest('hex') === digest) continue;
  } catch { /* Download assets that are not in the build cache. */ }
  const response = await fetch(`https://raw.githubusercontent.com/binji/wasm-clang/${revision}/${name}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`The toolchain download failed: ${name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error(`The toolchain checksum is incorrect: ${name}`);
  await writeFile(destination, gzipSync(bytes, { level: 9 }));
}
await build({ entryPoints: ['shell/app.js', 'shell/process-worker.js', 'shell/haddock-worker.js'], outdir: 'public/shell/assets',
  bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'eof',
  logOverride: { 'duplicate-object-key': 'silent' } });
await copyFile('node_modules/@xterm/xterm/css/xterm.css', 'public/shell/assets/xterm.css');
console.log('Built the browser shell and C toolchain.');

// Builder inputs use immutable URLs so cached files cannot change between builds.
const { GENERATOR } = await import('../documentation/contract.js');
await mkdir('public/builder/assets', { recursive: true });
await mkdir('public/builder/runtime', { recursive: true });
const runtime = { generator: GENERATOR, modules: [] };
const moduleNames = JSON.parse(await readFile('generated/haddock/modules.json', 'utf8'));
for (const name of [...moduleNames.map(name => `${name}.gz`), 'core-libs.tar.gz']) {
  const bytes = await readFile(`public/shell/haddock/${name}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const url = `/builder/runtime/${sha256}.gz`;
  await writeFile(`public${url}`, bytes);
  const entry = { name: name.replace(/\.gz$/, ''), sha256, url };
  if (name === 'core-libs.tar.gz') runtime.core = entry;
  else runtime.modules.push(entry);
}
await writeFile('public/builder/runtime.json', JSON.stringify(runtime));
await build({ entryPoints: ['builder/app.js', 'builder/runner.js'], outdir: 'public/builder/assets',
  bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'eof',
  logOverride: { 'duplicate-object-key': 'silent' } });
console.log('Built the documentation builder.');
