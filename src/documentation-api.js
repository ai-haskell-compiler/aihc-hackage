import { timingSafeEqual } from 'node:crypto';
import { startDocumentationWorkflow } from './documentation-plan.js';
import { HttpError, json, limitedBytes } from './http.js';
import { GENERATOR, TARGET, MAX_MODEL, HASH, NAME, VERSION, canonical, digest, encode, validateModel } from '../documentation/contract.js';

const now = () => Math.floor(Date.now() / 1000);
const token = () => `${crypto.randomUUID()}${crypto.randomUUID()}`;
const fail = (status, message) => { throw new HttpError(status, message); };
function same(a, b) {
  const left = encode(a || ''); const right = encode(b || '');
  return left.length === right.length && timingSafeEqual(left, right);
}
async function payload(request, limit = 4096) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'Send JSON.');
  const bytes = await limitedBytes(request, limit);
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  }
  catch { fail(400, 'The request contains invalid JSON.'); }
}
async function publicWrite(request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) fail(403, 'Use the documentation page on this site.');
  const limit = await env.DOC_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
  if (!limit.success) fail(429, 'The documentation request limit was reached. Try again in one minute.');
}
export async function getPlan(env, id) {
  if (!HASH.test(id)) fail(400, 'The plan identifier is invalid.');
  const row = await env.DB.prepare('SELECT object_key FROM documentation_plans WHERE id=?').bind(id).first();
  const object = row && await env.CABAL.get(row.object_key);
  if (!object) fail(404, 'The documentation plan is not available.');
  return object.json();
}
export async function getResult(env, id) {
  if (!HASH.test(id)) fail(400, 'The documentation identifier is invalid.');
  const row = await env.DB.prepare('SELECT * FROM documentation_results WHERE id=?').bind(id).first();
  if (!row) fail(404, 'The documentation is not available.');
  const object = await env.CABAL.get(row.object_key);
  if (!object) fail(503, 'The documentation file is not available.');
  return { ...row, model: await object.json(), plan: await getPlan(env, row.plan_id) };
}
export async function latestResult(env, name, version, planId) {
  return env.DB.prepare(`SELECT id, plan_id, provenance, diagnostics, created_at FROM documentation_results
    WHERE name=? AND version=? ${planId ? 'AND plan_id=?' : ''}
    ORDER BY (provenance='verified') DESC, created_at DESC, id LIMIT 1`)
    .bind(name, version, ...(planId ? [planId] : [])).first();
}
async function jobReply(env, job) {
  if (job.state === 'running' && env.DOC_WORKFLOW) {
    const status = await (await env.DOC_WORKFLOW.get(job.workflow_id)).status();
    if (['errored', 'terminated'].includes(status.status)) {
      job = { ...job, state: 'failed', error: 'The Cloudflare planning workflow stopped. Start the build again in five minutes.' };
      await env.DB.prepare("UPDATE documentation_jobs SET state='failed',error=?,updated_at=? WHERE id=? AND workflow_id=? AND state='running'")
        .bind(job.error, now(), job.id, job.workflow_id).run();
    }
  }
  return json({ id: job.id, state: job.state, error: job.error,
    plan: job.state === 'ready' ? { id: job.plan_id, ...await getPlan(env, job.plan_id) } : null,
    result: job.state === 'ready' ? await latestResult(env, job.name, job.version, job.plan_id) : null }, job.state === 'queued' || job.state === 'running' ? 202 : 200);
}
async function requestPlan(request, env) {
  await publicWrite(request, env);
  if (!env.DOC_WORKFLOW) fail(503, 'The documentation workflow is not configured.');
  const data = await payload(request);
  if (!NAME.test(data?.name) || !VERSION.test(data?.version)) fail(400, 'Enter a package name and an exact version.');
  const release = await env.DB.prepare('SELECT sha256 FROM releases WHERE name=? AND version=?').bind(data.name, data.version).first();
  if (!release) fail(404, 'Import this package version before you generate documentation.');
  const id = await digest(encode(canonical([data.name, data.version, release.sha256, GENERATOR, TARGET])));
  const time = now();
  await env.DB.prepare(`INSERT INTO documentation_jobs (id,name,version,cabal_sha256,generator,state,updated_at,workflow_id)
    VALUES (?,?,?,?,?,'queued',?,?) ON CONFLICT(id) DO UPDATE SET state='queued',error=NULL,workflow_id=excluded.workflow_id,updated_at=excluded.updated_at
    WHERE (documentation_jobs.state='ready' AND documentation_jobs.updated_at<?)
       OR (documentation_jobs.state='failed' AND documentation_jobs.updated_at<?)`)
    .bind(id, data.name, data.version, release.sha256, GENERATOR, time, crypto.randomUUID(), time - 86400, time - 300).run();
  const job = await env.DB.prepare('SELECT * FROM documentation_jobs WHERE id=?').bind(id).first();
  if (job.state === 'queued') await startDocumentationWorkflow(env, job.workflow_id, { kind: 'plan', jobId: job.id });
  return jobReply(env, job);
}
async function beginUpload(request, env) {
  await publicWrite(request, env);
  const data = await payload(request);
  const plan = await getPlan(env, data?.planId);
  if (plan.generator !== GENERATOR || !HASH.test(data.modelSha256)) fail(422, 'The upload has an unsupported plan or checksum.');
  const existing = await env.DB.prepare('SELECT id FROM documentation_results WHERE plan_id=? AND model_sha256=?').bind(data.planId, data.modelSha256).first();
  if (existing) {
    await startDocumentationWorkflow(env, `verify-${existing.id}`, { kind: 'verify', resultId: existing.id });
    return json({ result: existing });
  }
  const id = crypto.randomUUID(); const secret = token();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM documentation_uploads WHERE expires_at<?').bind(now() - 86400),
    env.DB.prepare('INSERT INTO documentation_uploads (id,plan_id,token_hash,model_sha256,expires_at) VALUES (?,?,?,?,?)')
      .bind(id, data.planId, await digest(encode(secret)), data.modelSha256, now() + 1800),
  ]);
  return json({ id, token: secret, maxBytes: MAX_MODEL, expiresAt: now() + 1800 }, 201);
}
async function upload(request, env, id) {
  await publicWrite(request, env);
  const row = await env.DB.prepare('SELECT * FROM documentation_uploads WHERE id=?').bind(id).first();
  const hash = await digest(encode((request.headers.get('Authorization') || '').replace(/^Bearer /, '')));
  if (!row || !same(row.token_hash, hash)) fail(403, 'The upload token is invalid.');
  if (row.result_id) {
    await startDocumentationWorkflow(env, `verify-${row.result_id}`, { kind: 'verify', resultId: row.result_id });
    return json({ id: row.result_id, url: `/docs/${row.result_id}` });
  }
  if (row.expires_at <= now()) fail(410, 'The upload token expired. Start the upload again.');
  const bytes = await limitedBytes(request, MAX_MODEL);
  if (await digest(bytes) !== row.model_sha256) fail(422, 'The documentation checksum does not match.');
  const plan = await getPlan(env, row.plan_id);
  let model;
  try { model = validateModel(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), plan); }
  catch (error) { fail(422, error.message); }
  const idResult = await digest(encode(`${row.plan_id}:${row.model_sha256}`)); const key = `documentation/models/${row.model_sha256}.json`;
  await env.CABAL.put(key, bytes, { httpMetadata: { contentType: 'application/json' } });
  const diagnostics = model.modules.reduce((sum, mod) => sum + mod.diagnostics.length, 0);
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO documentation_results (id,plan_id,name,version,model_sha256,object_key,provenance,diagnostics,created_at)
      SELECT ?,?,?,?,?,?,'community',?,? FROM documentation_uploads WHERE id=? AND expires_at>?
      ON CONFLICT(plan_id,model_sha256) DO NOTHING`).bind(idResult, row.plan_id, plan.root.name, plan.root.version, row.model_sha256, key, diagnostics, now(), id, now()),
    env.DB.prepare('UPDATE documentation_uploads SET result_id=? WHERE id=? AND expires_at>?').bind(idResult, id, now()),
  ]);
  if (!results[1].meta.changes) fail(410, 'The upload token expired. Start the upload again.');
  await startDocumentationWorkflow(env, `verify-${idResult}`, { kind: 'verify', resultId: idResult });
  return json({ id: idResult, url: `/docs/${idResult}` }, 201);
}

export async function documentationApi(request, env, url) {
  const path = url.pathname.slice('/api/docs'.length);
  if (path.startsWith('/runner/')) fail(404, 'The runner route does not exist.');
  if (path === '/plans' && request.method === 'POST') return requestPlan(request, env);
  if (path === '/uploads' && request.method === 'POST') return beginUpload(request, env);
  const uploadPath = /^\/uploads\/([a-f0-9-]{36})$/.exec(path);
  if (uploadPath && request.method === 'PUT') return upload(request, env, uploadPath[1]);
  if (request.method !== 'GET' && request.method !== 'HEAD') fail(405, 'This method is not available.');
  const jobPath = /^\/jobs\/([a-f0-9]{64})$/.exec(path);
  if (jobPath) {
    const job = await env.DB.prepare('SELECT * FROM documentation_jobs WHERE id=?').bind(jobPath[1]).first();
    if (!job) fail(404, 'The planning job does not exist.');
    return jobReply(env, job);
  }
  const planPath = /^\/plans\/([a-f0-9]{64})$/.exec(path);
  if (planPath) return json({ id: planPath[1], ...await getPlan(env, planPath[1]) });
  const modelPath = /^\/results\/([a-f0-9]{64})\/model$/.exec(path);
  if (modelPath) {
    const result = await getResult(env, modelPath[1]);
    const object = await env.CABAL.get(result.object_key);
    return new Response(object.body, { headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${result.name}-${result.version}.json"`, 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }
  const resultPath = /^\/results\/([a-f0-9]{64})$/.exec(path);
  if (resultPath) return json(await getResult(env, resultPath[1]));
  const objectPath = /^\/objects\/([a-f0-9]{64})$/.exec(path);
  if (objectPath) {
    const row = await env.DB.prepare('SELECT * FROM documentation_objects WHERE sha256=?').bind(objectPath[1]).first();
    const object = row && await env.CABAL.get(row.object_key);
    if (!object) fail(404, 'The source file is not available.');
    return new Response(request.method === 'HEAD' ? null : object.body, { headers: {
      'Content-Type': row.kind === 'source' ? 'application/gzip' : 'text/plain; charset=utf-8',
      'Content-Length': String(object.size), 'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff', ETag: `"${row.sha256}"`,
    } });
  }
  fail(404, 'The documentation route does not exist.');
}
