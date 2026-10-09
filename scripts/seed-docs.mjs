#!/usr/bin/env node
// Copy published documentation results into the local D1 and R2 stores.
// Usage: node scripts/seed-docs.mjs [--import] [RESULT_ID ...]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE = process.env.SEED_SOURCE || 'https://hackage.aihc.app';
const LOCAL = process.env.SEED_LOCAL || 'http://localhost:8787';
const BUCKET = 'aihc-hackage';
const DEFAULT_RESULTS = ['01bf5fdf943ec21d0c7bd440f79ac54307d1a2040c2d2e1277ca7f530ce1ba5f'];

const args = process.argv.slice(2);
const importReleases = args.includes('--import');
const ids = args.filter(arg => !arg.startsWith('--'));
const work = mkdtempSync(join(tmpdir(), 'aihc-seed-'));

function wrangler(...rest) {
  execFileSync('npx', ['wrangler', ...rest], { stdio: ['ignore', 'ignore', 'inherit'] });
}
function putObject(key, body) {
  const file = join(work, 'object.json');
  writeFileSync(file, body);
  wrangler('r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--content-type', 'application/json', '--local');
}
function quote(value) {
  return typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
}

try {
  wrangler('d1', 'migrations', 'apply', 'DB', '--local');
  for (const id of ids.length ? ids : DEFAULT_RESULTS) {
    const response = await fetch(`${SOURCE}/api/docs/results/${id}`);
    if (!response.ok) throw new Error(`${SOURCE} returned ${response.status} for result ${id}.`);
    const { model, plan, ...row } = await response.json();
    const planKey = `documentation/plans/${row.plan_id}.json`;
    putObject(row.object_key, JSON.stringify(model));
    putObject(planKey, JSON.stringify(plan));
    const sql = [
      `INSERT OR REPLACE INTO documentation_plans (id,name,version,object_key,created_at) VALUES (${[row.plan_id, row.name, row.version, planKey, row.created_at].map(quote).join(',')});`,
      `INSERT OR REPLACE INTO documentation_results (id,plan_id,name,version,model_sha256,object_key,provenance,diagnostics,created_at) VALUES (${[row.id, row.plan_id, row.name, row.version, row.model_sha256, row.object_key, row.provenance, row.diagnostics, row.created_at].map(quote).join(',')});`,
    ].join('\n');
    wrangler('d1', 'execute', 'DB', '--local', '--command', sql);
    console.log(`${row.name}-${row.version}: ${LOCAL}/docs/${row.id}`);
    if (importReleases) {
      // The import API needs the running development server.
      const reply = await fetch(`${LOCAL}/api/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: row.name, version: row.version }) });
      console.log(`  import: ${reply.status} ${reply.ok ? '' : await reply.text()}`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
