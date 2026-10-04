import { WASI, Fd, wasi } from '@bjorn3/browser_wasi_shim';
import { encode, decode, bytesText } from './codec.js';
import { Pipe } from './pipe.js';

export function executeProcess(options, send) {
  const state = new Int32Array(options.rpc, 0, 2);
  const payload = new Uint8Array(options.rpc, 8);
  function rpc(fd, method, args) {
    Atomics.store(state, 0, 0);
    send({ type: 'syscall', fd, method, args });
    while (!Atomics.load(state, 0)) Atomics.wait(state, 0, 0);
    return decode(payload.subarray(0, Atomics.load(state, 1)));
  }
  class RemoteFd extends Fd {
    constructor(id) { super(); this.id = id; }
  }
  const methods = ['fd_allocate', 'fd_close', 'fd_fdstat_get', 'fd_fdstat_set_flags', 'fd_fdstat_set_rights',
    'fd_filestat_get', 'fd_filestat_set_size', 'fd_filestat_set_times', 'fd_pread', 'fd_prestat_get',
    'fd_pwrite', 'fd_read', 'fd_readdir_single', 'fd_seek', 'fd_sync', 'fd_tell', 'fd_write',
    'path_create_directory', 'path_filestat_get', 'path_filestat_set_times', 'path_open',
    'path_readlink', 'path_remove_directory', 'path_unlink_file'];
  for (const method of methods) RemoteFd.prototype[method] = function (...args) {
    if (method === 'fd_read' || method === 'fd_pread') args[0] = Math.min(args[0], 65536);
    const result = rpc(this.id, method, args);
    if (result?.fd_obj != null) result.fd_obj = new RemoteFd(result.fd_obj);
    for (const [field, Class] of [['fdstat', wasi.Fdstat], ['filestat', wasi.Filestat], ['prestat', wasi.Prestat], ['dirent', wasi.Dirent]]) {
      if (result?.[field]) Object.setPrototypeOf(result[field], Class.prototype);
    }
    if (result?.prestat) Object.setPrototypeOf(result.prestat.inner, wasi.PrestatDir.prototype);
    return result;
  };
  class StreamFd extends Fd {
    constructor(stream, input) { super(); this.stream = stream; this.input = input; this.offset = 0; }
    fd_fdstat_get() { return { ret: 0, fdstat: new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0) }; }
    fd_filestat_get() { return { ret: 0, filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, 0n) }; }
    fd_read(size) {
      if (!this.input) return { ret: 8, data: new Uint8Array() };
      if (this.stream.pipe) return { ret: 0, data: new Pipe(this.stream.pipe).read(Math.min(size, 65536)) };
      const data = (this.stream.bytes || new Uint8Array()).slice(this.offset, this.offset + size);
      this.offset += data.length; return { ret: 0, data };
    }
    fd_write(bytes) {
      if (this.input) return { ret: 8, nwritten: 0 };
      if (this.stream.pipe) return new Pipe(this.stream.pipe).write(bytes);
      send({ type: 'output', stream: this.stream.name, bytes: bytes.slice() });
      return { ret: 0, nwritten: bytes.length };
    }
    fd_close() {
      if (this.stream.pipe) {
        const pipe = new Pipe(this.stream.pipe);
        if (this.input) pipe.closeReader(); else pipe.closeWriter();
      }
      return 0;
    }
  }
  const fds = [new StreamFd(options.stdin, true), new StreamFd(options.stdout, false),
    new StreamFd({ name: 'stderr' }, false), new RemoteFd(3), new RemoteFd(4)];
  const host = new WASI(options.argv, options.env, fds, { debug: false });
  host.wasiImport.args_sizes_get = (count, size) => {
    const view = new DataView(host.inst.exports.memory.buffer);
    view.setUint32(count, options.argv.length, true);
    view.setUint32(size, options.argv.reduce((total, arg) => total + new TextEncoder().encode(arg).length + 1, 0), true);
    return 0;
  };
  // Rename must be one filesystem operation for all processes.
  host.wasiImport.path_rename = (fd, oldPtr, oldLen, newFd, newPtr, newLen) => {
    if (!(host.fds[fd] instanceof RemoteFd) || !(host.fds[newFd] instanceof RemoteFd)) return 8;
    const memory = new Uint8Array(host.inst.exports.memory.buffer);
    return rpc(host.fds[fd].id, 'path_rename', [bytesText(memory.subarray(oldPtr, oldPtr + oldLen)),
      host.fds[newFd].id, bytesText(memory.subarray(newPtr, newPtr + newLen))]);
  };
  const legacy = { ...host.wasiImport };
  legacy.fd_seek = (fd, offset, whence, pointer) => host.wasiImport.fd_seek(fd, offset, [1, 2, 0][whence], pointer);
  const legacyStat = (fd, pointer, flags, path) => {
    const result = path === undefined ? host.fds[fd]?.fd_filestat_get() : host.fds[fd]?.path_filestat_get(flags, path);
    if (!result) return 8;
    if (result.ret) return result.ret;
    const stat = result.filestat;
    const view = new DataView(host.inst.exports.memory.buffer);
    view.setBigUint64(pointer, stat.dev, true); view.setBigUint64(pointer + 8, stat.ino, true);
    view.setUint8(pointer + 16, stat.filetype); view.setUint32(pointer + 20, Number(stat.nlink), true);
    for (const [i, field] of ['size', 'atim', 'mtim', 'ctim'].entries()) view.setBigUint64(pointer + 24 + i * 8, stat[field], true);
    return 0;
  };
  legacy.fd_filestat_get = (fd, pointer) => legacyStat(fd, pointer);
  legacy.path_filestat_get = (fd, flags, pointer, length, result) =>
    legacyStat(fd, result, flags, bytesText(new Uint8Array(host.inst.exports.memory.buffer, pointer, length)));
  try {
    let code;
    if (options.builtin) code = runBuiltin(options.builtin, options.argv.slice(1), options.cwd, rpc, fds);
    else {
      const instance = new WebAssembly.Instance(options.module, { wasi_snapshot_preview1: host.wasiImport, wasi_unstable: legacy });
      if (!instance.exports._start) throw new Error('The module must export _start.');
      code = host.start(instance);
    }
    fds[0].fd_close(); fds[1].fd_close();
    send({ type: 'exit', code });
  } catch (error) {
    fds[0].fd_close(); fds[1].fd_close();
    send({ type: 'exit', code: 1, error: error.message });
  }
}

function runBuiltin(command, args, cwd, rpc, fds) {
  const write = bytes => { const result = fds[1].fd_write(bytes); if (result.ret) throw new Error('The pipe is closed.'); };
  if (command === 'cat') {
    for (const path of args.length ? args : [null]) {
      const opened = path === null ? null : rpc(3, 'path_open', [0, path, 0, 2n, 0n, 0]);
      if (opened?.ret) throw new Error(`The file cannot be opened: ${path}`);
      for (;;) {
        const result = opened ? rpc(opened.fd_obj, 'fd_read', [65536]) : fds[0].fd_read(65536);
        if (result.ret) throw new Error('The file cannot be read.');
        if (!result.data.length) break;
        write(result.data);
      }
      if (opened) rpc(opened.fd_obj, 'fd_close', []);
    }
  } else {
    const result = rpc(3, 'utility', [command, args, cwd]);
    if (result.error) throw new Error(result.error);
    if (result.bytes) write(result.bytes);
  }
  return 0;
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = event => executeProcess(event.data, message => self.postMessage(message));
}

export function reply(buffer, result) {
  const state = new Int32Array(buffer, 0, 2);
  const payload = new Uint8Array(buffer, 8);
  let bytes = encode(result);
  if (bytes.length > payload.length) bytes = encode({ ret: wasi.ERRNO_2BIG });
  payload.set(bytes); Atomics.store(state, 1, bytes.length);
  Atomics.store(state, 0, 1); Atomics.notify(state, 0);
}
