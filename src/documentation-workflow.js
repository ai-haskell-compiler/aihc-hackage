import { WorkflowEntrypoint } from 'cloudflare:workers';
import { instantiate } from '../generated/planner/planner.js';
import { getCoreModule } from '../generated/planner/core-modules.js';
import core from '../generated/planner/core.json';
import { getCoreModule as getHaddockModule } from '../generated/haddock/core-modules.js';
import { runPlanner } from './planner-runtime.js';
import { buildDocumentation, checkedDownload } from '../builder/runner.js';
import { resolveDocumentationPlan } from './documentation-plan.js';
import { getResult } from './documentation-api.js';
import { canonical, digest, encode } from '../documentation/contract.js';

export class DocumentationWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    if (event.payload.kind === 'verify') return this.verify(event.payload.resultId, step);
    const id = event.payload.jobId;
    try {
      const job = await step.do('start', async () => {
        return this.env.DB.prepare("UPDATE documentation_jobs SET state='running' WHERE id=? AND workflow_id=? AND state IN ('queued','running') RETURNING *")
          .bind(id, event.instanceId).first();
      });
      if (!job) return { skipped: true };
      const plan = await resolveDocumentationPlan(this.env, job, { core, step, solve: async state => {
        return runPlanner(instantiate, getCoreModule, state);
      } });
      return await step.do('publish', async () => {
        const text = canonical(plan); const planId = await digest(encode(text)); const key = `documentation/plans/${planId}.json`;
        await this.env.CABAL.put(key, text, { httpMetadata: { contentType: 'application/json' } });
        await this.env.DB.batch([
          this.env.DB.prepare('INSERT INTO documentation_plans (id,name,version,object_key,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
            .bind(planId, job.name, job.version, key, Math.floor(Date.now() / 1000)),
          this.env.DB.prepare("UPDATE documentation_jobs SET state='ready',plan_id=?,error=NULL,updated_at=? WHERE id=? AND workflow_id=?")
            .bind(planId, Math.floor(Date.now() / 1000), id, event.instanceId),
        ]);
        return { planId };
      });
    } catch (error) {
      await step.do('record-failure', async () => {
        await this.env.DB.prepare("UPDATE documentation_jobs SET state='failed',error=?,updated_at=? WHERE id=? AND workflow_id=?")
          .bind(String(error.message).slice(0, 2000), Math.floor(Date.now() / 1000), id, event.instanceId).run();
      });
      throw error;
    }
  }
  async verify(id, step) {
    return step.do('rebuild', { retries: { limit: 1, delay: '10 seconds' }, timeout: '5 minutes' }, async () => {
      const record = await getResult(this.env, id);
      const assets = path => this.env.ASSETS.fetch(new Request(`https://assets.local${path}`));
      const runtime = await (await assets('/builder/runtime.json')).json();
      const result = await buildDocumentation({ id: record.plan_id, ...record.plan }, { runtime, getCompiledModule: getHaddockModule,
        download: (path, hash, limit) => checkedDownload(path, hash, limit, async url => {
          if (url.startsWith('/builder/runtime/')) return assets(url);
          if (!/^\/api\/docs\/objects\/[a-f0-9]{64}$/.test(url)) throw new Error('The verification input address is invalid.');
          const object = await this.env.CABAL.get(`documentation/objects/${hash}`);
          return object ? new Response(object.body) : new Response(null, { status: 404 });
        }) });
      const sha = await digest(encode(result.modelText));
      if (sha !== record.model_sha256) return { verified: false };
      await this.env.DB.prepare("UPDATE documentation_results SET provenance='verified' WHERE id=? AND model_sha256=?").bind(id, sha).run();
      return { verified: true };
    });
  }
}

// Only the Workflow binding can start work in this Worker.
export default { fetch: () => new Response('Not found.', { status: 404 }) };
