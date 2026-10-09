import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { FileSystem } from '../shell/filesystem.js';
import { Processes } from '../shell/processes.js';
import { Shell } from '../shell/shell.js';
import { bytesText } from '../shell/codec.js';

const fixture = path => readFile(new URL(`./fixtures/docs-sample/${path}`, import.meta.url));

async function runtime() {
  const fs = new FileSystem();
  let output = '';
  const write = bytes => { output += typeof bytes === 'string' ? bytes : bytesText(bytes); };
  const nodeWorker = file => () => {
    const worker = new Worker(new URL(`./helpers/${file}`, import.meta.url));
    const adapter = { postMessage: data => worker.postMessage(data), terminate: () => worker.terminate() };
    worker.on('message', data => adapter.onmessage?.({ data }));
    worker.on('error', error => adapter.onerror?.({ message: error.message }));
    return adapter;
  };
  const processes = new Processes(fs, write, nodeWorker('shell-worker.mjs'), nodeWorker('haddock-worker.mjs'));
  const shell = new Shell(fs, processes, write, async () => {}, () => {});
  // The browser downloads these files. The test reads the build output instead.
  const names = JSON.parse(await readFile('generated/haddock/modules.json', 'utf8'));
  const modules = Object.fromEntries(await Promise.all(names.map(async name =>
    [name, await WebAssembly.compile(await readFile(`generated/haddock/${name}`))])));
  const coreLibs = new Uint8Array(gunzipSync(await readFile('public/shell/haddock/core-libs.tar.gz')));
  shell.haddock = Promise.resolve({ modules, coreLibs });
  return { fs, shell, output: () => output };
}

async function addSample(fs) {
  fs.mkdir('/home/user/docs-sample/src/Docs', true);
  fs.write('/home/user/docs-sample/docs-sample.cabal', await fixture('docs-sample.cabal'));
  fs.write('/home/user/docs-sample/src/Docs/Sample.hs', await fixture('src/Docs/Sample.hs'));
}

test('aihc-haddock documents a package from the shell files', async () => {
  const { fs, shell, output } = await runtime();
  await addSample(fs);
  const code = await shell.execute('aihc-haddock build docs-sample --no-deps --json docs.json --hoogle docs.txt');
  assert.equal(code, 0, output());
  assert.match(output(), /docs-sample-0\.1\.0\.0: 1 exposed modules/);
  const model = JSON.parse(bytesText(fs.read('/home/user/docs.json')));
  assert.equal(model.format_version, 2);
  assert.deepEqual(model.modules.map(module => module.name), ['Docs.Sample']);
  const hoogle = bytesText(fs.read('/home/user/docs.txt'));
  assert.match(hoogle, /greet :: String -> String/);
  assert.match(hoogle, /Make a greeting for a name\./);
  assert.deepEqual(fs.list('/home/user'), ['docs-sample/', 'docs.json', 'docs.txt']);
});

test('aihc-haddock reports an error for a missing package', async () => {
  const { shell, output } = await runtime();
  const code = await shell.execute('aihc-haddock build missing --no-deps');
  assert.notEqual(code, 0);
  assert.match(output(), /missing/);
});

test('aihc-haddock writes to a pipe', async () => {
  const { fs, shell, output } = await runtime();
  await addSample(fs);
  assert.equal(await shell.execute('aihc-haddock build docs-sample --no-deps | cat > summary.txt'), 0, output());
  assert.match(bytesText(fs.read('/home/user/summary.txt')), /1 exposed modules/);
});

function tar(entries) {
  const blocks = entries.map(([path, text]) => {
    const body = new TextEncoder().encode(text);
    const header = new Uint8Array(512);
    const put = (value, offset) => header.set(new TextEncoder().encode(value), offset);
    put(path, 0); put(`${body.length.toString(8).padStart(11, '0')}\0`, 124); header[156] = 48;
    return Buffer.concat([header, body, new Uint8Array((512 - body.length % 512) % 512)]);
  });
  return gzipSync(Buffer.concat([...blocks, new Uint8Array(1024)]));
}

test('hackage-get unpacks a package from the site route', async () => {
  const { fs, shell, output } = await runtime();
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    requests.push(url);
    if (url === '/hackage/package/sample-1.0/sample-1.0.tar.gz') {
      return new Response(tar([['sample-1.0/sample.cabal', 'name: sample\n'], ['sample-1.0/src/A.hs', 'module A where\n']]));
    }
    if (url === '/hackage/package/evil-1.0/evil-1.0.tar.gz') return new Response(tar([['other-1.0/x', 'x']]));
    return Response.json({ error: 'Hackage does not have this file.' }, { status: 404 });
  };
  try {
    assert.equal(await shell.execute('hackage-get sample-1.0'), 0, output());
    assert.match(output(), /sample-1\.0: 2 files/);
    assert.equal(bytesText(fs.read('/home/user/sample-1.0/src/A.hs')), 'module A where\n');
    assert.equal(await shell.execute('hackage-get missing-1.0'), 1);
    assert.match(output(), /Hackage does not have this file\./);
    assert.equal(await shell.execute('hackage-get evil-1.0'), 1);
    assert.match(output(), /The package archive is not valid\./);
    assert.equal(await shell.execute('hackage-get ../x'), 1);
    assert.match(output(), /Enter a package and a version/);
    assert.deepEqual(requests, ['/hackage/package/sample-1.0/sample-1.0.tar.gz', '/hackage/package/missing-1.0/missing-1.0.tar.gz',
      '/hackage/package/evil-1.0/evil-1.0.tar.gz']);
  } finally { globalThis.fetch = original; }
});
