export async function execute(instantiate, getCoreModule, input) {
  const writes = [];
  let inputOffset = 0;
  const ok = () => ({ tag: 'ok', val: undefined });
  const capture = (limit) => {
    const buffer = new Uint8Array(limit);
    let length = 0;
    return {
      bytes: () => buffer.slice(0, length),
      writeViaStream(stream) {
        const task = (async () => {
          for await (const value of stream) {
            const count = typeof value === 'number' ? 1 : value.length;
            if (length + count > limit) throw new Error('Output exceeds the metadata limit');
            if (typeof value === 'number') buffer[length] = value;
            else buffer.set(value, length);
            length += count;
          }
          return ok();
        })();
        writes.push(task);
        return task;
      },
    };
  };
  const stdout = capture(4194304);
  const stderr = capture(65536);
  const origin = performance.now();
  const now = () => BigInt(Math.floor((performance.now() - origin) * 1e6));
  const imports = {
    'wasi:cli/environment': {
      getArguments: () => [],
      getInitialCwd: () => undefined,
    },
    'wasi:cli/stdin': {
      readViaStream: () => [
        (async function* () {
          while (inputOffset < input.length) {
            const end = Math.min(inputOffset + 256, input.length);
            const chunk = input.subarray(inputOffset, end);
            inputOffset = end;
            yield chunk;
          }
        })(),
        Promise.resolve(ok()),
      ],
    },
    'wasi:cli/stdout': stdout,
    'wasi:cli/stderr': stderr,
    'wasi:clocks/monotonic-clock': {
      now,
      waitUntil: async (when) => {
        const delay = Number(when - now()) / 1e6;
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      },
    },
    'wasi:filesystem/preopens': { getDirectories: () => [] },
    'wasi:filesystem/types': { Descriptor: class Descriptor {} },
  };
  const component = await instantiate(getCoreModule, imports);
  await component.run.run();
  await Promise.all(writes);
  return { stdout: stdout.bytes(), stderr: stderr.bytes() };
}
