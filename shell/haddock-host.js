// A WASI P3 host for the aihc-haddock component.
// It uses only standard JavaScript, so a Web Worker and Node.js can both load it.
// The filesystem is in memory. The component has no network access.

const textEncoder = new TextEncoder();

class HostError extends Error {
  constructor(tag, message = tag) { super(message); this.payload = { tag }; }
}

class ExitSignal extends Error {
  constructor(code) { super(`The program exited with code ${code}.`); this.code = code; }
}

class Node {
  constructor(type) { this.type = type; this.id = Node.nextId++; }
}
Node.nextId = 1;

class FileNode extends Node {
  constructor(bytes = new Uint8Array()) { super('regular-file'); this.bytes = bytes; this.changed = false; }
  write(offset, chunk) {
    const end = offset + chunk.length;
    if (end > this.bytes.length) {
      const grown = new Uint8Array(Math.max(end, this.bytes.length * 2));
      grown.set(this.bytes.subarray(0, this.size ?? this.bytes.length));
      this.bytes = grown;
    }
    this.bytes.set(chunk, offset);
    this.size = Math.max(this.size ?? 0, end);
    this.changed = true;
  }
  get length() { return this.size ?? this.bytes.length; }
  truncate() { this.bytes = new Uint8Array(); this.size = 0; this.changed = true; }
}

class DirNode extends Node {
  constructor() { super('directory'); this.entries = new Map(); }
}

export class MemoryFilesystem {
  constructor() { this.root = new DirNode(); }
  // Resolve a path and create missing directories when asked.
  directory(parts, create) {
    let node = this.root;
    for (const part of parts) {
      let next = node.entries.get(part);
      if (!next && create) { next = new DirNode(); node.entries.set(part, next); }
      if (!(next instanceof DirNode)) throw new HostError(next ? 'not-directory' : 'no-entry');
      node = next;
    }
    return node;
  }
  write(path, bytes) {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    const file = new FileNode(bytes);
    file.size = bytes.length;
    this.directory(parts, true).entries.set(name, file);
  }
  read(path) {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    const file = this.directory(parts, false).entries.get(name);
    if (!(file instanceof FileNode)) throw new HostError('no-entry');
    return file.bytes.subarray(0, file.length);
  }
  // Files that the program wrote since it started, as [path, bytes] pairs.
  changedFiles() {
    const result = [];
    const visit = (directory, prefix) => {
      for (const [name, node] of directory.entries) {
        if (node instanceof DirNode) visit(node, `${prefix}/${name}`);
        else if (node.changed) result.push([`${prefix}/${name}`, node.bytes.slice(0, node.length)]);
      }
    };
    visit(this.root, '');
    return result;
  }
}

function pathParts(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!parts.length) throw new HostError('not-permitted'); parts.pop(); } else parts.push(part);
  }
  return parts;
}

async function* chunksOf(bytes, size = 65536) {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
}

const ok = () => ({ tag: 'ok', val: undefined });

export function createHost({ filesystem, args, cwd, env = [], stdin = new Uint8Array(), onOutput }) {
  // Every descriptor holds a node and the permissions that its open call granted.
  class Descriptor {
    constructor(node, flags = { read: true, write: true, mutateDirectory: true }) { this.node = node; this.flags = flags; }
    #file() { if (!(this.node instanceof FileNode)) throw new HostError('is-directory'); return this.node; }
    #directory() { if (!(this.node instanceof DirNode)) throw new HostError('not-directory'); return this.node; }
    #split(path) {
      const parts = pathParts(path);
      if (!parts.length) return { parent: null, name: null };
      const name = parts.pop();
      let parent = this.#directory();
      for (const part of parts) {
        const next = parent.entries.get(part);
        if (!(next instanceof DirNode)) throw new HostError(next ? 'not-directory' : 'no-entry');
        parent = next;
      }
      return { parent, name };
    }
    readViaStream(offset) {
      const file = this.#file();
      return [chunksOf(file.bytes.subarray(Number(offset), file.length)), Promise.resolve(ok())];
    }
    async writeViaStream(data, offset) {
      const file = this.#file();
      let position = Number(offset);
      for await (const value of data) {
        const chunk = typeof value === 'number' ? Uint8Array.of(value) : value;
        file.write(position, chunk); position += chunk.length;
      }
      return ok();
    }
    async appendViaStream(data) {
      const file = this.#file();
      for await (const value of data) file.write(file.length, typeof value === 'number' ? Uint8Array.of(value) : value);
      return ok();
    }
    async getFlags() { return { ...this.flags }; }
    readDirectory() {
      const directory = this.#directory();
      const entries = [...directory.entries].map(([name, node]) => ({ type: { tag: node.type }, name }));
      return [(async function* () { yield* entries; })(), Promise.resolve(ok())];
    }
    async createDirectoryAt(path) {
      const { parent, name } = this.#split(path);
      if (!parent || parent.entries.has(name)) throw new HostError('exist');
      parent.entries.set(name, new DirNode());
    }
    #stat(node) {
      return { type: { tag: node.type }, linkCount: 1n, size: BigInt(node instanceof FileNode ? node.length : 0) };
    }
    async stat() { return this.#stat(this.node); }
    #lookup(path) {
      const { parent, name } = this.#split(path);
      if (!parent) return { parent, name, node: this.node };
      return { parent, name, node: parent.entries.get(name) };
    }
    async statAt(_pathFlags, path) {
      const { node } = this.#lookup(path);
      if (!node) throw new HostError('no-entry');
      return this.#stat(node);
    }
    async openAt(_pathFlags, path, openFlags, flags) {
      const { parent, name, node: existing } = this.#lookup(path);
      let node = existing;
      if (node && openFlags.create && openFlags.exclusive) throw new HostError('exist');
      if (!node) {
        if (!openFlags.create) throw new HostError('no-entry');
        node = new FileNode(); node.size = 0; node.changed = true;
        parent.entries.set(name, node);
      }
      if (openFlags.directory && !(node instanceof DirNode)) throw new HostError('not-directory');
      if (node instanceof DirNode && flags.write) throw new HostError('is-directory');
      if (openFlags.truncate && node instanceof FileNode) node.truncate();
      return new Descriptor(node, flags);
    }
    async renameAt(oldPath, newDescriptor, newPath) {
      const from = this.#lookup(oldPath);
      if (!from.node || !from.parent) throw new HostError('no-entry');
      const to = newDescriptor.#split(newPath);
      if (!to.parent) throw new HostError('invalid');
      from.parent.entries.delete(from.name);
      to.parent.entries.set(to.name, from.node);
      if (from.node instanceof FileNode) from.node.changed = true;
    }
    async unlinkFileAt(path) {
      const { parent, name, node } = this.#lookup(path);
      if (!node || !parent) throw new HostError('no-entry');
      if (node instanceof DirNode) throw new HostError('is-directory');
      parent.entries.delete(name);
    }
    async metadataHash() { return { lower: BigInt(this.node.id), upper: 0n }; }
    async metadataHashAt(_pathFlags, path) {
      const { node } = this.#lookup(path);
      if (!node) throw new HostError('no-entry');
      return { lower: BigInt(node.id), upper: 0n };
    }
  }

  const origin = performance.now();
  const now = () => BigInt(Math.floor((performance.now() - origin) * 1e6));
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const output = name => async data => {
    for await (const value of data) onOutput(name, typeof value === 'number' ? Uint8Array.of(value) : value.slice());
    return ok();
  };
  const root = new Descriptor(filesystem.root);

  return {
    imports: {
      'wasi:cli/environment': { getEnvironment: () => env, getArguments: () => args, getInitialCwd: () => cwd },
      'wasi:cli/exit': {
        exit: status => { throw new ExitSignal(status.tag === 'ok' ? 0 : 1); },
        exitWithCode: code => { throw new ExitSignal(code); },
      },
      'wasi:cli/stdin': { readViaStream: () => [chunksOf(stdin), Promise.resolve(ok())] },
      'wasi:cli/stdout': { writeViaStream: output('stdout') },
      'wasi:cli/stderr': { writeViaStream: output('stderr') },
      'wasi:cli/terminal-input': { TerminalInput: class TerminalInput {} },
      'wasi:cli/terminal-output': { TerminalOutput: class TerminalOutput {} },
      'wasi:cli/terminal-stdin': { getTerminalStdin: () => undefined },
      'wasi:cli/terminal-stdout': { getTerminalStdout: () => undefined },
      'wasi:cli/terminal-stderr': { getTerminalStderr: () => undefined },
      'wasi:clocks/monotonic-clock': {
        now,
        waitUntil: async when => { const delay = Number(when - now()) / 1e6; if (delay > 0) await sleep(delay); },
        waitFor: async duration => { await sleep(Number(duration) / 1e6); },
      },
      'wasi:clocks/system-clock': {
        now: () => { const milliseconds = Date.now(); return { seconds: BigInt(Math.floor(milliseconds / 1000)), nanoseconds: (milliseconds % 1000) * 1e6 }; },
      },
      'wasi:filesystem/preopens': { getDirectories: () => [[root, '/']] },
      'wasi:filesystem/types': { Descriptor },
      'wasi:http/client': { send: async () => { throw new HostError('other', 'The network is not available.'); } },
      'wasi:http/types': {
        Fields: class Fields {}, Request: class Request {}, RequestOptions: class RequestOptions {}, Response: class Response {},
      },
    },
  };
}

// Run the component to the end and return its exit code.
export async function runComponent(instantiate, getCoreModule, options) {
  const { imports } = createHost(options);
  try {
    const component = await instantiate(getCoreModule, imports);
    await component.run.run();
    return 0;
  } catch (error) {
    if (error instanceof ExitSignal) return error.code;
    // A Haskell exception that nothing catches traps the component.
    options.onOutput('stderr', textEncoder.encode(`${error?.message ?? 'The program stopped.'}\n`));
    return 1;
  }
}
