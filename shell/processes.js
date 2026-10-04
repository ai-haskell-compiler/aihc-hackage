import { PreopenDirectory, OpenDirectory, wasi } from '@bjorn3/browser_wasi_shim';
import { normalize } from './filesystem.js';
import { reply } from './process-worker.js';
import { textBytes } from './codec.js';

export const utilities = ['ls', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'pwd', 'echo', 'env', 'which', 'touch'];

export class Processes {
  constructor(fs, output, workerFactory = () => new Worker('/shell/assets/process-worker.js', { type: 'module' })) {
    this.fs = fs; this.output = output; this.workerFactory = workerFactory;
    this.nextPid = 1; this.running = new Map();
  }
  syscall(process, { fd: id, method, args }) {
    const descriptor = process.fds.get(id);
    if (!descriptor) return method.endsWith('_get') || method === 'path_open' ? { ret: 8 } : 8;
    const { fd, path } = descriptor;
    try {
      if (method === 'utility') return this.utility(...args, process.env);
      let operationFd = fd;
      let operationPath = path;
      if (method.startsWith('path_')) {
        const index = ['path_open', 'path_filestat_get', 'path_filestat_set_times'].includes(method) ? 1 : 0;
        operationPath = normalize(args[index], path);
        if (method === 'path_rename') {
          const target = process.fds.get(args[1]);
          if (!target) return 8;
          this.fs.rename(operationPath, normalize(args[2], target.path)); return 0;
        }
        const writes = ['path_create_directory', 'path_remove_directory', 'path_unlink_file', 'path_filestat_set_times'];
        if (writes.includes(method) || method === 'path_open' && ((args[2] & 9) || (args[3] & 64n))) this.fs.checkWrite(operationPath);
        operationFd = new OpenDirectory(this.fs.root);
        args[index] = operationPath.slice(1) || '.';
      } else if (['fd_allocate', 'fd_filestat_set_size', 'fd_filestat_set_times', 'fd_write', 'fd_pwrite'].includes(method)) {
        this.fs.checkWrite(path);
        if (method === 'fd_allocate' || method === 'fd_filestat_set_size') {
          const size = method === 'fd_allocate' ? args[0] + args[1] : args[0];
          if (size > 128n * 1024n * 1024n) return 27;
        }
      }
      if (method === 'fd_fdstat_set_flags') { descriptor.flags = args[0]; return 0; }
      if (method === 'fd_fdstat_set_rights') return 0;
      if (method === 'fd_write' && descriptor.flags & wasi.FDFLAGS_APPEND) fd.fd_seek(0n, wasi.WHENCE_END);
      const result = operationFd[method](...args);
      if (result?.fdstat) {
        result.fdstat.fs_rights_base = (1n << 29n) - 1n;
        result.fdstat.fs_rights_inherited = (1n << 29n) - 1n;
      }
      if (result?.fd_obj) {
        const handle = process.nextFd++;
        process.fds.set(handle, { fd: result.fd_obj, path: operationPath, flags: args[5] });
        result.fd_obj = handle;
      }
      if (method === 'fd_close') process.fds.delete(id);
      return result;
    } catch (error) {
      const ret = error.message.includes('read-only') ? 69 : 28;
      return ['fd_read', 'fd_pread', 'fd_write', 'fd_pwrite', 'fd_seek', 'fd_tell', 'fd_readdir_single',
        'fd_fdstat_get', 'fd_filestat_get', 'path_open', 'path_filestat_get'].includes(method) ? { ret } : ret;
    }
  }
  utility(command, args, cwd, env) {
    const path = value => normalize(value, cwd);
    const need = count => { if (args.length < count) throw new Error('The command needs more arguments.'); };
    try {
      let output = '';
      switch (command) {
        case 'echo': output = args.join(' ') + '\n'; break;
        case 'pwd': output = cwd + '\n'; break;
        case 'env': output = env.join('\n') + '\n'; break;
        case 'ls': output = (args.length ? args : ['.']).map(value => this.fs.list(path(value)).join('  ')).join('\n') + '\n'; break;
        case 'cat': return { bytes: args.reduce((all, value) => { const bytes = this.fs.read(path(value)); const joined = new Uint8Array(all.length + bytes.length); joined.set(all); joined.set(bytes, all.length); return joined; }, new Uint8Array()) };
        case 'mkdir': { const recursive = args.includes('-p'); args.filter(arg => arg !== '-p').forEach(value => this.fs.mkdir(path(value), recursive)); need(1); break; }
        case 'rm': { const recursive = args.includes('-r'); args.filter(arg => arg !== '-r').forEach(value => this.fs.remove(path(value), recursive)); need(1); break; }
        case 'cp': need(2); this.fs.write(path(args[1]), this.fs.read(path(args[0]))); break;
        case 'mv': need(2); this.fs.rename(path(args[0]), path(args[1])); break;
        case 'touch': need(1); args.forEach(value => { try { this.fs.node(path(value)); } catch { this.fs.write(path(value), new Uint8Array()); } }); break;
        case 'which': need(1); output = args.map(value => { this.fs.node(`/bin/${value}`); return `/bin/${value}`; }).join('\n') + '\n'; break;
        default: throw new Error('The command is not available.');
      }
      return { bytes: textBytes(output) };
    } catch (error) { return { error: error.message }; }
  }
  spawn(module, argv, env, cwd, stdin, stdout, onOutput = this.output, builtin) {
    const pid = this.nextPid++;
    const worker = this.workerFactory();
    const rpc = new SharedArrayBuffer(1024 * 1024);
    const process = { pid, argv, env, worker, rpc, fds: new Map([
      [3, { fd: new PreopenDirectory('.', this.fs.node(cwd).contents), path: cwd }],
      [4, { fd: new PreopenDirectory('/', this.fs.root.contents), path: '/' }],
    ]), nextFd: 5 };
    process.done = new Promise(resolve => {
      process.finish = (code, error) => {
        if (!this.running.has(pid)) return;
        if (error) this.output(`${argv[0]}: ${error}\n`);
        for (const [stream, closed, wake] of [[stdin, 3, 0], [stdout, 2, 1]]) {
          if (stream.pipe) { const state = new Int32Array(stream.pipe, 0, 4); Atomics.store(state, closed, 1); Atomics.notify(state, wake); }
        }
        this.running.delete(pid); worker.terminate(); resolve(code);
      };
      worker.onmessage = ({ data }) => {
        if (data.type === 'syscall') reply(rpc, this.syscall(process, data));
        else if (data.type === 'output') onOutput(data.bytes, data.stream);
        else if (data.type === 'exit') process.finish(data.code, data.error);
      };
      worker.onerror = event => process.finish(1, event.message);
    });
    this.running.set(pid, process);
    process.stdin = stdin; process.stdout = stdout;
    worker.postMessage({ module, builtin, argv, env, cwd, stdin, stdout, rpc });
    return process;
  }
  kill(pid) {
    const process = this.running.get(Number(pid));
    if (!process) throw new Error('The process does not exist.');
    process.finish(130);
  }
}
