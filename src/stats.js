// Collect the site statistics from D1 and from the Cloudflare GraphQL Analytics API.
export const TRAFFIC_DAYS = 30;
export const TRAFFIC_HOSTS = ['hackage.aihc.app', 'haddock.aihc.app'];
const BUCKET = 'aihc-hackage';
const CACHE_SECONDS = 3600;
const PARTIAL_CACHE_SECONDS = 300;
const CACHE_KEY = 'https://stats.cache.invalid/cloudflare';

const QUERY = `query ($zone: String!, $account: String!, $hosts: [String!], $bucket: String!, $since: Time!, $until: Time!, $storageSince: Time!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      traffic: httpRequestsAdaptiveGroups(limit: 10, filter: { datetime_geq: $since, datetime_lt: $until, clientRequestHTTPHost_in: $hosts }) {
        count
        sum { edgeResponseBytes visits }
        dimensions { clientRequestHTTPHost }
      }
    }
    accounts(filter: { accountTag: $account }) {
      storage: r2StorageAdaptiveGroups(limit: 1, filter: { datetime_geq: $storageSince, datetime_lt: $until, bucketName: $bucket }, orderBy: [datetime_DESC]) {
        max { payloadSize metadataSize objectCount }
        dimensions { datetime }
      }
    }
  }
}`;

// Read the analytics from the Cloudflare API. The token must have Account Analytics and Zone Analytics read access.
async function fetchAnalytics(env, now) {
  const until = new Date(now);
  const since = new Date(now - TRAFFIC_DAYS * 86400000);
  const storageSince = new Date(now - 2 * 86400000);
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: {
      zone: env.ANALYTICS_ZONE_ID, account: env.ANALYTICS_ACCOUNT_ID, hosts: TRAFFIC_HOSTS, bucket: BUCKET,
      since: since.toISOString(), until: until.toISOString(), storageSince: storageSince.toISOString(),
    } }),
  });
  if (!response.ok) throw new Error(`The analytics API returned status ${response.status}.`);
  const result = await response.json();
  const zone = result.data?.viewer?.zones?.[0];
  const account = result.data?.viewer?.accounts?.[0];
  // The API can return part of the data with errors, for example when the token cannot read the account.
  const errors = result.errors?.map(error => error.message) || [];
  if (errors.length && !zone && !account) throw new Error(errors.join(' '));
  if (errors.length) console.error(JSON.stringify({ event: 'analytics-error', message: errors.join(' ') }));
  const hosts = TRAFFIC_HOSTS.map(host => {
    const row = zone?.traffic?.find(group => group.dimensions.clientRequestHTTPHost === host);
    return { host, requests: row?.count || 0, bytes: row?.sum.edgeResponseBytes || 0, visits: row?.sum.visits || 0 };
  });
  const storage = account?.storage?.[0];
  return {
    fetchedAt: until.toISOString(),
    complete: errors.length === 0,
    traffic: zone ? { since: since.toISOString(), until: until.toISOString(), hosts } : null,
    storage: storage ? { bytes: storage.max.payloadSize + storage.max.metadataSize, objects: storage.max.objectCount, measuredAt: storage.dimensions.datetime } : null,
  };
}

// Keep the analytics in the edge cache for one hour, because the API has rate limits and the data changes slowly.
async function cachedAnalytics(env, ctx) {
  if (!env.CLOUDFLARE_ANALYTICS_TOKEN || !env.ANALYTICS_ZONE_ID || !env.ANALYTICS_ACCOUNT_ID) return null;
  const cache = globalThis.caches?.default;
  const cached = await cache?.match(CACHE_KEY);
  if (cached) return cached.json();
  try {
    const analytics = await fetchAnalytics(env, Date.now());
    const response = new Response(JSON.stringify(analytics), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${analytics.complete ? CACHE_SECONDS : PARTIAL_CACHE_SECONDS}` } });
    if (cache) ctx.waitUntil(cache.put(CACHE_KEY, response));
    return analytics;
  } catch (error) {
    console.error(JSON.stringify({ event: 'analytics-error', message: error.message }));
    return null;
  }
}

export async function loadStats(env, ctx) {
  const [catalogue, analytics] = await Promise.all([
    env.DB.batch([
      env.DB.prepare('SELECT COUNT(DISTINCT name) AS packages, COUNT(*) AS versions FROM releases'),
      env.DB.prepare('SELECT COUNT(*) AS documentation FROM documentation_results'),
    ]),
    cachedAnalytics(env, ctx),
  ]);
  const [releases, documentation] = catalogue;
  return {
    packages: releases.results[0].packages,
    versions: releases.results[0].versions,
    documentation: documentation.results[0].documentation,
    database: { bytes: documentation.meta?.size_after ?? null },
    storage: analytics?.storage || null,
    traffic: analytics?.traffic || null,
    analyticsFetchedAt: analytics?.fetchedAt || null,
  };
}
