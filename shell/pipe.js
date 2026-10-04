// One writer and one reader share each pipe.
export class Pipe {
  constructor(buffer = new SharedArrayBuffer(16 + 65536)) {
    this.buffer = buffer;
    this.state = new Int32Array(buffer, 0, 4);
    this.data = new Uint8Array(buffer, 16);
  }
  read(size) {
    if (!size) return new Uint8Array();
    for (;;) {
      const read = Atomics.load(this.state, 0);
      const write = Atomics.load(this.state, 1);
      const count = Math.min(size, (write - read) >>> 0);
      if (count) {
        const result = new Uint8Array(count);
        for (let i = 0; i < count; i++) result[i] = this.data[((read >>> 0) + i) % this.data.length];
        Atomics.store(this.state, 0, read + count);
        Atomics.notify(this.state, 0);
        return result;
      }
      if (Atomics.load(this.state, 2)) return new Uint8Array();
      Atomics.wait(this.state, 1, write);
    }
  }
  write(bytes) {
    let offset = 0;
    while (offset < bytes.length) {
      if (Atomics.load(this.state, 3)) return { ret: 64, nwritten: offset };
      const read = Atomics.load(this.state, 0);
      const write = Atomics.load(this.state, 1);
      const count = Math.min(bytes.length - offset, this.data.length - ((write - read) >>> 0));
      if (!count) { Atomics.wait(this.state, 0, read); continue; }
      for (let i = 0; i < count; i++) this.data[((write >>> 0) + i) % this.data.length] = bytes[offset + i];
      offset += count;
      Atomics.store(this.state, 1, write + count);
      Atomics.notify(this.state, 1);
    }
    return { ret: 0, nwritten: offset };
  }
  closeWriter() { Atomics.store(this.state, 2, 1); Atomics.notify(this.state, 1); }
  closeReader() { Atomics.store(this.state, 3, 1); Atomics.notify(this.state, 0); }
  // The terminal runs on the main thread and cannot use Atomics.wait.
  writeAvailable(bytes) {
    const read = Atomics.load(this.state, 0), write = Atomics.load(this.state, 1);
    if (Atomics.load(this.state, 3) || bytes.length > this.data.length - ((write - read) >>> 0)) return false;
    for (let i = 0; i < bytes.length; i++) this.data[((write >>> 0) + i) % this.data.length] = bytes[i];
    Atomics.store(this.state, 1, write + bytes.length); Atomics.notify(this.state, 1); return true;
  }
}
