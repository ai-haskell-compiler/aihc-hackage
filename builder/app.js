import { digest, encode, validateModel } from '../documentation/contract.js';
import { previewHtml } from '../documentation/render.js';
import { saved } from './storage.js';

const root = document.querySelector('#builder');
const el = name => document.querySelector(`#build-${name}`);
const supported = typeof WebAssembly.Suspending === 'function' && typeof Worker === 'function' && typeof DecompressionStream === 'function';
let current; let operation; let packageRequest = 0; let allowRebuild = false;
const stages = ['plan', 'download', 'generate', 'upload'];
function progress(stage, message) {
  const index = stages.indexOf(stage);
  for (const item of root.querySelectorAll('[data-stage]')) {
    const position = stages.indexOf(item.dataset.stage);
    item.classList.toggle('complete', position < index); item.classList.toggle('active', position === index);
  }
  el('status').textContent = message;
}
function log(line) {
  el('details').hidden = false;
  const output = el('log'); const end = output.scrollTop + output.clientHeight >= output.scrollHeight - 4;
  output.append(`${output.textContent ? '\n' : ''}${line}`);
  if (end) output.scrollTop = output.scrollHeight;
}
function error(message) { el('error').hidden = !message; el('error').textContent = message || ''; }
function busy(value) {
  el('name').disabled = value; el('version').disabled = value;
  el('start').disabled = value || !supported || !el('version').value;
  el('cancel').hidden = !value;
}
async function api(path, { body, method = body ? 'POST' : 'GET', headers, signal } = {}) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed. Try again.');
  return data;
}
function existing(result) {
  el('existing').hidden = false; el('existing-link').href = `/docs/${result.id}`;
  el('existing-link').textContent = `Read ${result.provenance === 'verified' ? 'verified' : 'community'} documentation →`;
}
function clearResult() {
  current = null;
  for (const name of ['output', 'preview', 'details', 'existing']) el(name).hidden = true;
  el('result').replaceChildren(); el('log').textContent = '';
  el('status').textContent = '';
  for (const item of root.querySelectorAll('[data-stage]')) item.classList.remove('complete', 'active');
}
function display(result) {
  current = result; validateModel(result.model, result.plan);
  el('output').hidden = false; el('preview').hidden = false; el('upload').disabled = false;
  const count = result.model.modules.filter(mod => mod.exposed).length;
  const diagnostics = result.model.modules.reduce((sum, mod) => sum + mod.diagnostics.length, 0);
  el('summary').textContent = `${result.model.name}-${result.model.version}: ${count} exposed modules. ${diagnostics} generation diagnostics.`;
  el('module').replaceChildren(...result.model.modules.filter(mod => mod.exposed).map(mod => new Option(mod.name, mod.name)));
  el('preview-content').innerHTML = previewHtml(result.model, el('module').value);
  el('details').hidden = false;
  el('log').textContent = `Generator: ${result.plan.generator}\nTarget: ${result.plan.target}\nPlan: ${result.plan.id}\n\n${result.log || ''}`;
  progress('upload', 'The preview is ready. Review the result before you upload it.');
}
async function loadPackage() {
  const number = ++packageRequest; const name = el('name').value.trim();
  el('start').disabled = true; allowRebuild = false; el('start').textContent = 'Generate documentation';
  clearResult();
  if (!name) return;
  try {
    const pkg = await api(`/api/packages/${encodeURIComponent(name)}`);
    if (number !== packageRequest) return;
    const wanted = root.dataset.name === name ? root.dataset.version : el('version').value;
    el('version').replaceChildren(...pkg.versions.map(item => new Option(item.version, item.version)));
    if (pkg.versions.some(item => item.version === wanted)) el('version').value = wanted;
    el('synopsis').textContent = (pkg.fields.synopsis || []).join(' ') || 'Imported Hackage package';
    error(''); await restore();
  } catch (problem) {
    if (number !== packageRequest) return;
    el('version').replaceChildren(new Option('No imported version', '')); error(problem.message);
  }
  if (number === packageRequest) busy(false);
}
async function restore() {
  const name = el('name').value.trim(); const version = el('version').value;
  clearResult(); el('status').textContent = ''; el('start').textContent = 'Generate documentation';
  const record = await saved('results', `${name}-${version}`);
  if (name !== el('name').value.trim() || version !== el('version').value) return;
  if (record) { try { display(record); el('saved').textContent = 'The completed result was restored from this browser.'; } catch { /* Ignore incompatible saved results. */ } }
  const pkg = await api(`/api/packages/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
  if (name === el('name').value.trim() && version === el('version').value && pkg.documentation) existing(pkg.documentation);
}
let searchTimer;
el('name').addEventListener('input', () => {
  packageRequest++; el('start').disabled = true; clearResult(); clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const query = el('name').value;
    try {
      const data = await api(`/api/packages?q=${encodeURIComponent(query)}`);
      if (query !== el('name').value) return;
      el('packages').replaceChildren(...data.packages.map(pkg => new Option(pkg.name, pkg.name)));
      await loadPackage();
    } catch (problem) { error(problem.message); }
  }, 300);
});
el('version').addEventListener('change', () => { allowRebuild = false; restore().catch(problem => error(problem.message)); });
el('module').addEventListener('change', () => { if (current) el('preview-content').innerHTML = previewHtml(current.model, el('module').value); });
el('cancel').addEventListener('click', () => { operation?.abort(); });
function pause(signal) {
  return new Promise((accept, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); accept(); }, 2000);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
// The time limit applies to each step, so a plan with many packages gets more time.
const STEP_LIMIT = 600000;
function generate(plan, signal) {
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
el('form').addEventListener('submit', async event => {
  event.preventDefault(); if (!supported) return;
  error(''); clearResult(); busy(true); operation = new AbortController(); const { signal } = operation;
  const name = el('name').value.trim(); const version = el('version').value;
  try {
    el('details').open = true;
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
    if (job.result && !allowRebuild) {
      existing(job.result); allowRebuild = true; el('start').textContent = 'Generate again';
      progress('upload', 'Documentation already exists for this plan. You can read it or generate another result.'); return;
    }
    el('result').replaceChildren();
    log(`The plan has ${job.plan.packages.length} packages: ${job.plan.packages.map(pkg => `${pkg.name}-${pkg.version}`).join(', ')}.`);
    const result = await generate(job.plan, signal); display(result);
    const stored = await saved('results', `${name}-${version}`, result);
    el('saved').textContent = stored ? 'The result is saved in this browser. You can retry the upload later.' : 'Browser storage is unavailable. Download the result before you close this page.';
  } catch (problem) {
    if (problem.name === 'AbortError') { progress('plan', 'The build was cancelled. Saved files remain available.'); log('The build was cancelled.'); }
    else { error(problem.message); log(`Error: ${problem.message}`); }
  } finally { operation = null; busy(false); }
});
el('upload').addEventListener('click', async () => {
  if (!current) return;
  el('upload').disabled = true; busy(true); el('cancel').hidden = true; error('');
  try {
    const record = current;
    const ticket = await api('/api/docs/uploads', { body: { planId: record.plan.id, modelSha256: await digest(encode(record.modelText)) } });
    const result = ticket.result || await api(`/api/docs/uploads/${ticket.id}`, { method: 'PUT', body: record.modelText, headers: { Authorization: `Bearer ${ticket.token}` } });
    const link = document.createElement('a'); link.href = `/docs/${result.id}`; link.textContent = 'Read the uploaded documentation →';
    el('result').replaceChildren(link); progress('upload', 'The community contribution was uploaded.');
  } catch (problem) { error(problem.message); }
  finally { el('upload').disabled = false; busy(false); }
});
function download(text, extension, type) {
  const url = URL.createObjectURL(new Blob([text], { type })); const link = document.createElement('a');
  link.href = url; link.download = `${current.plan.root.name}-${current.plan.root.version}.${extension}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
el('download').addEventListener('click', () => { if (current) download(current.modelText, 'json', 'application/json'); });
el('hoogle').addEventListener('click', () => { if (current) download(current.hoogle, 'txt', 'text/plain'); });
if (!supported) el('capability').textContent = 'This browser cannot run the generator. Use a browser with WebAssembly JSPI support. Published documentation remains available.';
if (root.dataset.name) await loadPackage();
