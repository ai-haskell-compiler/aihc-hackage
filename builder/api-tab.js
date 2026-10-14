// Generate and upload the documentation from the API tab of a package page, then open the result.
import { saved } from './storage.js';
import { UNSUPPORTED, appendLog, generate, requestPlan, showStage, supported, upload } from './client.js';

const root = document.querySelector('#api-build');
const el = name => document.querySelector(`#api-build-${name}`);
const { name, version } = root.dataset;
let operation;

function progress(stage, message) { el('stages').hidden = false; showStage(root, stage); el('status').textContent = message; }
function log(line) { el('details').hidden = false; appendLog(el('log'), line); }
function error(message) { el('error').hidden = !message; el('error').textContent = message || ''; }
function busy(value) { el('start').disabled = value || !supported; el('cancel').hidden = !value; }
const open = result => { location.assign(`/docs/${result.id}`); };

el('start').addEventListener('click', async () => {
  if (!supported) return;
  error(''); el('log').textContent = ''; busy(true); operation = new AbortController(); const { signal } = operation;
  try {
    const job = await requestPlan(name, version, signal, { log, progress });
    if (job.result) { progress('upload', 'Documentation already exists. Opening the documentation.'); return open(job.result); }
    // Use a completed result from this browser if its upload failed before.
    const key = `${name}-${version}`; const record = await saved('results', key);
    let result;
    if (record?.plan?.id === job.plan.id && record.modelText) { result = record; log('This browser has a completed result for this plan. The generator does not run again.'); }
    else {
      log(`The plan has ${job.plan.packages.length} packages: ${job.plan.packages.map(pkg => `${pkg.name}-${pkg.version}`).join(', ')}.`);
      result = await generate(job.plan, signal, { log, progress });
      await saved('results', key, result);
    }
    progress('upload', 'Uploading the documentation.'); log('Uploading the documentation.');
    el('cancel').hidden = true;
    const published = await upload(result);
    progress('upload', 'The documentation was uploaded. Opening the documentation.'); log('The upload is complete.');
    open(published);
  } catch (problem) {
    if (problem.name === 'AbortError') { el('status').textContent = 'The build was cancelled. Saved files remain available.'; log('The build was cancelled.'); }
    else { error(problem.message); log(`Error: ${problem.message}`); el('start').textContent = 'Try again'; }
    busy(false);
  } finally { operation = null; }
});
el('cancel').addEventListener('click', () => { operation?.abort(); });
if (!supported) el('capability').textContent = UNSUPPORTED;
busy(false);
