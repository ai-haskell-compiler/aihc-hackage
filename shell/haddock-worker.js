import { instantiate } from '../generated/haddock/haddock.js';
import { MemoryFilesystem, runComponent } from './haddock-host.js';
import { readTar } from './tar.js';
import { Pipe } from './pipe.js';

// Run aihc-haddock with an in-memory copy of the files under the shell directory and the core libraries.
// The component resolves relative paths against the root, so the shell directory becomes the root.
// The shell copies back the files that the program wrote when the program exits.
export async function executeHaddock(options, send) {
  const { module: modules, argv, env, cwd, stdin, stdout, files, coreLibs } = options;
  const filesystem = new MemoryFilesystem();
  const prefix = cwd === '/' ? '' : cwd;
  for (const [path, bytes] of files) if (path.startsWith(`${prefix}/`)) filesystem.write(path.slice(prefix.length), bytes);
  for (const entry of readTar(coreLibs)) if (entry.kind === 'file') filesystem.write(`/${entry.path}`, entry.bytes);
  const onOutput = (stream, bytes) => {
    if (stream === 'stdout' && stdout.pipe) new Pipe(stdout.pipe).write(bytes);
    else send({ type: 'output', stream, bytes });
  };
  let code;
  try {
    code = await runComponent(instantiate, path => modules[path], {
      filesystem, args: argv, cwd: '/', stdin: stdin.bytes, onOutput,
      // The artifact cache lives in memory only, because each run starts with a new filesystem.
      env: [...env.map(entry => { const split = entry.indexOf('='); return [entry.slice(0, split), entry.slice(split + 1)]; })
        .filter(([name]) => name !== 'HOME'), ['HOME', '/.home'], ['XDG_CACHE_HOME', '/.cache']],
    });
  } finally {
    if (stdout.pipe) new Pipe(stdout.pipe).closeWriter();
    if (stdin.pipe) new Pipe(stdin.pipe).closeReader();
  }
  const written = filesystem.changedFiles().filter(([path]) => !path.startsWith('/.cache/') && !path.startsWith('/.home/')).map(([path, bytes]) => [`${prefix}${path}`, bytes]);
  send({ type: 'exit', code, files: written });
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = event => executeHaddock(event.data, message => self.postMessage(message))
    .catch(error => self.postMessage({ type: 'exit', code: 1, error: error.message }));
}
