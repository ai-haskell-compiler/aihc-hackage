import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { FileSystem, normalize } from '../shell/filesystem.js';
import { Processes } from '../shell/processes.js';
import { Shell } from '../shell/shell.js';
import { parse } from '../shell/parser.js';
import { unpackTar } from '../shell/toolchain.js';
import { bytesText } from '../shell/codec.js';
import { gunzipSync } from 'node:zlib';

function runtime() {
  const fs = new FileSystem();
  let output = '';
  const write = bytes => { output += typeof bytes === 'string' ? bytes : bytesText(bytes); };
  const processes = new Processes(fs, write, () => {
    const worker = new Worker(new URL('./helpers/shell-worker.mjs', import.meta.url));
    const adapter = { postMessage: data => worker.postMessage(data), terminate: () => worker.terminate() };
    worker.on('message', data => adapter.onmessage?.({ data }));
    worker.on('error', error => adapter.onerror?.({ message: error.message }));
    return adapter;
  });
  const shell = new Shell(fs, processes, write, async () => {}, () => {});
  return { fs, shell, processes, output: () => output };
}

test('parse quoted text, file operators, pipelines, and jobs', () => {
  const jobs = parse('echo "hello $USER" > out | cat & pwd; echo \'$USER\'', { USER: 'browser' });
  assert.equal(jobs.length, 3);
  assert.equal(jobs[0].commands[0].argv[1], 'hello browser');
  assert.equal(jobs[0].background, true);
  assert.equal(jobs[2].commands[0].argv[1], '$USER');
  for (const line of ['cat |', 'echo >', 'echo "hello', 'cat && cat']) assert.throws(() => parse(line));
});

test('retain home files and protect system directories', () => {
  const fs = new FileSystem();
  fs.mkdir('/home/user/src'); fs.write('/home/user/src/a', 'first');
  fs.write('/home/user/src/a', ' second', true); fs.rename('/home/user/src/a', '/home/user/src/b');
  const fresh = new FileSystem(); fresh.restore(fs.snapshot());
  assert.equal(bytesText(fresh.read('/home/user/src/b')), 'first second');
  assert.equal(normalize('../b', '/home/user/src'), '/home/user/b');
  assert.throws(() => fs.write('/bin/tool', 'changed'));
  assert.throws(() => fs.rename('/home/user/src', '/home/user/src/child'));
});

test('execute utilities with streaming pipes, redirection, and background jobs', { timeout: 20000 }, async () => {
  const { shell, fs, output, processes } = runtime();
  assert.equal(await shell.execute('echo "hello browser" > message; cat message | cat > result'), 0);
  assert.equal(bytesText(fs.read('/home/user/result')), 'hello browser\n');
  fs.write('/home/user/large', new Uint8Array(2000000).fill(65));
  assert.equal(await shell.execute('cat large | cat > copy'), 0);
  assert.deepEqual(fs.read('/home/user/copy'), fs.read('/home/user/large'));
  assert.equal(await shell.execute('echo one & echo two & wait'), 0);
  assert.match(output(), /one/); assert.match(output(), /two/); assert.equal(processes.running.size, 0);
  const task = await shell.pipeline([{ argv: ['cat'] }, { argv: ['cat'], output: 'stopped' }], false);
  shell.foreground = task.processes;
  shell.interrupt();
  assert.equal(await task.done, 130);
  assert.equal(processes.running.size, 0);
});

test('execute an uploaded WASI Preview 1 module with terminal and pipe input', { timeout: 20000 }, async () => {
  const { shell, fs, output } = runtime();
  fs.write('/home/user/echo.wasm', await readFile('test/fixtures/shell-echo.wasm'));
  assert.equal(await shell.execute('echo preview1 | ./echo.wasm > result'), 0, output());
  assert.equal(bytesText(fs.read('/home/user/result')), 'preview1\n');
  const task = await shell.pipeline([{ argv: ['./echo.wasm'] }], false);
  assert.equal(shell.input(new TextEncoder().encode('terminal\n')), true);
  shell.endInput();
  assert.equal(await task.done, 0);
  assert.match(output(), /terminal/);
});

test('compile C and execute the resulting WASI module in a process Worker', { timeout: 60000 }, async () => {
  const { shell, fs, output } = runtime();
  const bytes = await Promise.all(['clang', 'lld', 'sysroot.tar'].map(async name => gunzipSync(await readFile(`public/shell/toolchain/${name}.gz`))));
  unpackTar(bytes[2], fs);
  shell.toolchain = Promise.all(bytes.slice(0, 2).map(bytes => WebAssembly.compile(bytes)));
  fs.write('/home/user/hello.c', '#include <stdio.h>\nint main(int argc, char **argv) { printf("Hello %s\\n", argc > 1 ? argv[1] : "browser"); return 0; }\n');
  const code = await shell.execute('clang hello.c -o hello.wasm');
  assert.equal(code, 0, output());
  assert.equal(await shell.execute('./hello.wasm worker'), 0, output());
  assert.match(output(), /Hello worker/);
  assert.equal(await shell.execute('echo pipe | ./hello.wasm pipeline > output'), 0, output());
  assert.match(bytesText(fs.read('/home/user/output')), /Hello pipeline/);
  assert.equal(await shell.execute('clang hello.c -o one.wasm & clang hello.c -o two.wasm & wait'), 0, output());
  assert.ok(fs.read('/home/user/one.wasm').length);
  assert.ok(fs.read('/home/user/two.wasm').length);
  fs.write('/home/user/input.c', '#include <stdio.h>\nint main(void) { char line[32]; if (fgets(line, sizeof line, stdin)) printf("Input: %s", line); return 0; }\n');
  assert.equal(await shell.execute('clang input.c -o input.wasm; echo shared | ./input.wasm'), 0, output());
  assert.match(output(), /Input: shared/);
  const inputTask = await shell.pipeline([{ argv: ['./input.wasm'] }], false);
  assert.equal(shell.input(new TextEncoder().encode('terminal\n')), true);
  assert.equal(await inputTask.done, 0);
  assert.match(output(), /Input: terminal/);
  fs.write('/home/user/invalid.c', 'This is not C.');
  assert.equal(await shell.execute('clang invalid.c -o invalid.wasm | cat'), 0, output());
});
