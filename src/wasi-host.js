export async function execute(instantiate, getCoreModule, input) {
  const stdout = [];
  const stderr = [];
  const writes = [];
  let inputOffset = 0;
  const ok = () => ({ tag: 'ok', val: undefined });
  const capture = (target) => ({
    writeViaStream(stream) {
      const task = (async () => {
        for await (const value of stream) {
          if (typeof value === 'number') target.push(value);
          else target.push(...value);
          if (target.length > 4194304) throw new Error('Output exceeds the metadata limit');
        }
        return ok();
      })();
      writes.push(task);
      return task;
    },
  });
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
    'wasi:cli/stdout': capture(stdout),
    'wasi:cli/stderr': capture(stderr),
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
  return { stdout: Uint8Array.from(stdout), stderr: Uint8Array.from(stderr) };
}
