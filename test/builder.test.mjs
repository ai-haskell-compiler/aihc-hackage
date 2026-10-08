import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDocumentation } from '../builder/runner.js';
import { fixturePlan } from './helpers/documentation.mjs';
import { canonical, digest, encode } from '../documentation/contract.js';

test('The browser generator uses the planned Cabal revision, flags, and target without solving.', async () => {
  const { plan, files } = await fixturePlan();
  const id = await digest(encode(canonical(plan)));
  const runtime = JSON.parse(await readFile('public/builder/runtime.json', 'utf8'));
  const stages = [];
  const result = await buildDocumentation({ id, ...plan }, { runtime, progress: event => stages.push(event.stage),
    download: async (url, hash) => files.get(hash) || new Uint8Array(await readFile(`public${url}`)) });
  assert.deepEqual(result.model.modules.map(mod => mod.name).sort(), ['Docs.Extra', 'Docs.Linux', 'Docs.Sample']);
  assert.match(result.hoogle, /greet :: String -> String/);
  assert.ok(stages.includes('generate'));
  await assert.rejects(buildDocumentation({ ...plan, id: '0'.repeat(64) }, { runtime }), /checksum/);
});
