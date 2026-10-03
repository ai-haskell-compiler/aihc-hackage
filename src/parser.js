import { instantiate } from '../generated/parser.js';
import { getCoreModule } from '../generated/core-modules.js';
import { execute } from './wasi-host.js';

export async function parseCabal(bytes) {
  const result = await execute(instantiate, getCoreModule, bytes);
  const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout));
  if (metadata.error) throw new Error(metadata.error);
  if (metadata.schemaVersion !== 1 || !Array.isArray(metadata.components)) {
    throw new Error('The parser returned invalid metadata.');
  }
  return metadata;
}
