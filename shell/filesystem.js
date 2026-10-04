import { Directory, File, OpenDirectory } from '@bjorn3/browser_wasi_shim';
import { textBytes } from './codec.js';

export function normalize(path, cwd = '/') {
  if (path.includes('\0')) throw new Error('The path contains a null character.');
  const parts = [];
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `/${parts.join('/')}`;
}
export class FileSystem {
  constructor() {
    this.root = new Directory(new Map());
    for (const path of ['/bin', '/usr/include', '/usr/lib', '/tmp', '/home/user']) this.mkdir(path, true, true);
  }
  node(path) {
    path = normalize(path);
    let node = this.root;
    for (const part of path.slice(1).split('/').filter(Boolean)) {
      if (!(node instanceof Directory)) throw new Error('The path is not a directory.');
      node = node.contents.get(part);
      if (!node) throw new Error(`The path does not exist: ${path}`);
    }
    return node;
  }
  writable(path) { return /^\/(home\/user|tmp)(\/|$)/.test(normalize(path)); }
  checkWrite(path) { if (!this.writable(path)) throw new Error('The system directory is read-only.'); }
  parent(path) {
    path = normalize(path);
    const split = path.lastIndexOf('/');
    const parent = this.node(path.slice(0, split) || '/');
    if (!(parent instanceof Directory)) throw new Error('The parent is not a directory.');
    return [parent, path.slice(split + 1)];
  }
  mkdir(path, recursive = false, system = false) {
    path = normalize(path);
    if (!system) this.checkWrite(path);
    let node = this.root;
    const parts = path.slice(1).split('/').filter(Boolean);
    for (const [i, part] of parts.entries()) {
      let child = node.contents.get(part);
      if (!child) {
        if (!recursive && i < parts.length - 1) throw new Error('The parent directory does not exist.');
        child = new Directory(new Map()); child.parent = node; node.contents.set(part, child);
      } else if (i === parts.length - 1 && !recursive) throw new Error('The directory exists.');
      if (!(child instanceof Directory)) throw new Error('The path is not a directory.');
      node = child;
    }
  }
  write(path, bytes, append = false, system = false) {
    if (!system) this.checkWrite(path);
    const [parent, name] = this.parent(path);
    let file = parent.contents.get(name);
    if (file instanceof Directory) throw new Error('The path is a directory.');
    if (!file) { file = new File(new Uint8Array()); parent.contents.set(name, file); }
    if (typeof bytes === 'string') bytes = textBytes(bytes);
    const result = new Uint8Array((append ? file.data.length : 0) + bytes.length);
    if (append) result.set(file.data);
    result.set(bytes, append ? file.data.length : 0); file.data = result;
    file.readonly = system;
  }
  read(path) {
    const file = this.node(path);
    if (!(file instanceof File)) throw new Error('The path is a directory.');
    return file.data.slice();
  }
  list(path) {
    const node = this.node(path);
    if (!(node instanceof Directory)) return [path.split('/').pop()];
    return [...node.contents].map(([name, child]) => name + (child instanceof Directory ? '/' : '')).sort();
  }
  remove(path, recursive = false) {
    path = normalize(path); this.checkWrite(path);
    if (path === '/home/user' || path === '/tmp') throw new Error('The directory is in use.');
    const node = this.node(path);
    if (node instanceof Directory && node.contents.size && !recursive) throw new Error('The directory is not empty.');
    const [parent, name] = this.parent(path); parent.contents.delete(name);
  }
  rename(source, target) {
    source = normalize(source); target = normalize(target);
    this.checkWrite(source); this.checkWrite(target);
    if (target.startsWith(`${source}/`) || source === '/home/user' || source === '/tmp') throw new Error('The move is not valid.');
    const node = this.node(source);
    const [parent, name] = this.parent(target);
    const old = parent.contents.get(name);
    if (old && ((old instanceof Directory) !== (node instanceof Directory) || old instanceof Directory && old.contents.size)) {
      throw new Error('The destination cannot be replaced.');
    }
    this.parent(source)[0].contents.delete(this.parent(source)[1]);
    parent.contents.set(name, node);
    if (node instanceof Directory) node.parent = parent;
  }
  openDirectory(path) { return new OpenDirectory(this.node(path)); }
  snapshot() {
    const entries = [];
    const walk = (node, path) => {
      if (node instanceof File) entries.push({ path, data: node.data });
      else { entries.push({ path, directory: true }); for (const [name, child] of node.contents) walk(child, `${path}/${name}`); }
    };
    walk(this.node('/home/user'), '/home/user'); return entries;
  }
  restore(entries) {
    for (const entry of entries) {
      if (!normalize(entry.path).startsWith('/home/user/')) continue;
      if (entry.directory) this.mkdir(entry.path, true);
      else { this.mkdir(entry.path.slice(0, entry.path.lastIndexOf('/')), true); this.write(entry.path, entry.data); }
    }
  }
}
