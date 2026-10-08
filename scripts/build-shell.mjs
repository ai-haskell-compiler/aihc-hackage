import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const { revision, files } = JSON.parse(await readFile(new URL('../shell/toolchain.json', import.meta.url), 'utf8'));
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
