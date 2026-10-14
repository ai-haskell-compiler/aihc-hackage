// Shared browser steps for the builder page and the API tab of a package page.
import { digest, encode } from '../documentation/contract.js';

export const supported = typeof WebAssembly.Suspending === 'function' && typeof Worker === 'function' && typeof DecompressionStream === 'function';
export const UNSUPPORTED = 'This browser cannot run the generator. Use a browser with WebAssembly JSPI support. Published documentation remains available.';
const stages = ['plan', 'download', 'generate', 'upload'];

// Mark the stages before the given stage as complete and the given stage as active.
export function showStage(root, stage) {
  const index = stages.indexOf(stage);
  for (const item of root.querySelectorAll('[data-stage]')) {
    const position = stages.indexOf(item.dataset.stage);
    item.classList.toggle('complete', position < index); item.classList.toggle('active', position === index);
  }
}
// Add a line to a log element. Keep the log at the end if the visitor did not scroll up.
export function appendLog(output, line) {
  const end = output.scrollTop + output.clientHeight >= output.scrollHeight - 4;
  output.append(`${output.textContent ? '\n' : ''}${line}`);
  if (end) output.scrollTop = output.scrollHeight;
}
export async function api(path, { body, method = body ? 'POST' : 'GET', headers, signal } = {}) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed. Try again.');
  return data;
}
function pause(signal) {
  return new Promise((accept, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); accept(); }, 2000);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
// Request a dependency plan and wait until the planner finishes. The ready job can contain a saved result.
export async function requestPlan(name, version, signal, { log, progress }) {
  progress('plan', 'Requesting a dependency plan.'); log(`Requesting a dependency plan for ${name}-${version}.`);
  let job = await api('/api/docs/plans', { body: { name, version }, signal });
  const started = Date.now(); let state;
  while (job.state === 'queued' || job.state === 'running') {
    if (job.state !== state) log(job.state === 'queued' ? 'The plan request is in the queue.' : 'The planner is resolving the dependencies.');
    state = job.state;
    progress('plan', job.state === 'queued' ? 'Waiting for the planner. You can cancel and return later.' : 'Resolving the dependency plan.');
    if (Date.now() - started > 600000) throw new Error('The planner is still busy. Return to this page later.');
    await pause(signal); job = await api(`/api/docs/jobs/${job.id}`, { signal });
  }
  if (job.state !== 'ready') throw new Error(job.error || 'The dependency plan could not be made.');
  return job;
}
// The time limit applies to each step, so a plan with many packages gets more time.
const STEP_LIMIT = 600000;
export function generate(plan, signal, { log, progress }) {
  return new Promise((accept, reject) => {
    const worker = new Worker('/builder/assets/runner.js', { type: 'module' });
    let step = 'Starting the generator.'; let timeout;
    const wait = () => { clearTimeout(timeout); timeout = setTimeout(() => finish(new Error(`The build stopped at one step for more than ten minutes: ${step}`)), STEP_LIMIT); };
    wait();
    const cancel = () => finish(new DOMException('Cancelled', 'AbortError'));
    const finish = (problem, result) => { clearTimeout(timeout); signal.removeEventListener('abort', cancel); worker.terminate(); problem ? reject(problem) : accept(result); };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = event => {
      const message = event.data;
      if (message.line) log(message.line);
      if (message.type === 'progress') {
        step = message.message; wait();
        progress(message.stage, `${message.message}${message.total ? ` ${message.completed} of ${message.total} packages.` : ''}`);
      } else if (message.type === 'result') finish(null, message.result);
      else if (message.type === 'error') finish(new Error(message.message));
    };
    worker.onerror = () => finish(new Error('The generator stopped. This device may not have enough memory.'));
    worker.postMessage({ plan });
  });
}
// Upload a completed result and return the published result record.
export async function upload(record) {
  const ticket = await api('/api/docs/uploads', { body: { planId: record.plan.id, modelSha256: await digest(encode(record.modelText)) } });
  return ticket.result || await api(`/api/docs/uploads/${ticket.id}`, { method: 'PUT', body: record.modelText, headers: { Authorization: `Bearer ${ticket.token}` } });
}
