import { MemoryFilesystem, runComponent } from '../shell/haddock-host.js';
import { encode } from '../documentation/contract.js';

export async function runPlanner(instantiate, getModule, state) {
  const filesystem = new MemoryFilesystem();
  filesystem.write('/request.json', encode(JSON.stringify(state)));
  let output = ''; let errors = '';
  const status = await runComponent(instantiate, getModule, {
    filesystem, args: ['aihc-doc-plan'], cwd: '/', stdin: new Uint8Array(),
    onOutput: (stream, bytes) => {
      const text = new TextDecoder().decode(bytes);
      if (stream === 'stdout') { if (output.length + text.length > 1024 * 1024) throw new Error('The planner output exceeds the size limit.'); output += text; }
      else if (errors.length < 65536) errors += text;
    },
  });
  if (status !== 0) throw new Error(errors.slice(-2000) || 'The planner stopped.');
  return JSON.parse(output);
}
