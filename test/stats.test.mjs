import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStats } from '../src/stats.js';

const statement = results => ({ results, meta: { size_after: 4096 } });
const db = { prepare: sql => sql, batch: async () => [statement([{ packages: 2, versions: 3 }]), statement([{ documentation: 1 }])] };
const env = { DB: db, CLOUDFLARE_ANALYTICS_TOKEN: 'token', ANALYTICS_ZONE_ID: 'zone', ANALYTICS_ACCOUNT_ID: 'account' };
const ctx = { waitUntil() {} };

test('The statistics keep the traffic data when the token cannot read the account.', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    data: { viewer: { zones: [{ traffic: [{ count: 10, sum: { edgeResponseBytes: 2048, visits: 4 }, dimensions: { clientRequestHTTPHost: 'hackage.aihc.app' } }] }], accounts: null } },
    errors: [{ message: 'not authorized for that account' }],
  }));
  t.mock.method(console, 'error', () => {});
  const stats = await loadStats(env, ctx);
  assert.equal(stats.packages, 2);
  assert.equal(stats.database.bytes, 4096);
  assert.equal(stats.storage, null);
  assert.deepEqual(stats.traffic.hosts[0], { host: 'hackage.aihc.app', requests: 10, bytes: 2048, visits: 4 });
  assert.deepEqual(stats.traffic.hosts[1], { host: 'haddock.aihc.app', requests: 0, bytes: 0, visits: 0 });
});

test('The statistics show the D1 values when the analytics API fails.', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: null, errors: [{ message: 'authentication error' }] }));
  t.mock.method(console, 'error', () => {});
  const stats = await loadStats(env, ctx);
  assert.equal(stats.versions, 3);
  assert.equal(stats.traffic, null);
  assert.equal(stats.analyticsFetchedAt, null);
});
