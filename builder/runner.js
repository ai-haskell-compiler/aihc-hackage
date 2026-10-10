import { instantiate } from '../generated/haddock/haddock.js';
import { MemoryFilesystem, runComponent } from '../shell/haddock-host.js';
import { GENERATOR, MAX_SOURCE, MAX_UNPACKED, canonical, digest, encode, validatePlan, validateModel } from '../documentation/contract.js';
import { boundedBytes, decompress, sourceEntries } from '../documentation/archive.js';
import { saved } from './storage.js';

export async function checkedDownload(url, sha256, limit, fetcher = fetch) {
  const cached = await saved('files', sha256);
  if (cached && cached.length <= limit && await digest(cached) === sha256) return cached;
  const response = await fetcher(url, { redirect: 'error' });
  if (!response.ok) throw new Error('A build input could not be downloaded. Try again.');
  const bytes = await boundedBytes(response.body, limit);
  if (await digest(bytes) !== sha256) throw new Error('A build input has an incorrect checksum.');
  await saved('files', sha256, bytes);
  return bytes;
}
export async function buildDocumentation(plan, { progress: report = () => {}, runtime, getCompiledModule, download = checkedDownload } = {}) {
  validatePlan(plan);
  // Keep a copy of the log in the result, so a saved result shows how it was made.
  const started = Date.now(); const history = [];
  const log = (message, event = { type: 'log', message }) => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const line = `[${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}] ${message}`;
    if (history.length < 4000) history.push(line);
    report({ ...event, line });
  };
  const progress = event => log(`${event.message}${event.total ? ` ${event.completed} of ${event.total} packages.` : ''}`, { type: 'progress', ...event });
  if (plan.id && await digest(encode(canonical(Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'id'))))) !== plan.id) throw new Error('The plan checksum is incorrect.');
  if (!runtime) {
    const response = await fetch('/builder/runtime.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('The documentation generator is not available.');
    runtime = await response.json();
  }
  if (runtime.generator !== GENERATOR) throw new Error('The generator changed. Reload this page before you build.');
  progress({ stage: 'download', message: 'Loading the documentation generator.' });
  const compiled = {};
  for (const file of runtime.modules) compiled[file.name] = getCompiledModule ? getCompiledModule(file.name) : await WebAssembly.compile(await decompress(await download(file.url, file.sha256, MAX_SOURCE)));
  const fs = new MemoryFilesystem();
  let total = 0;
  const coreBytes = await decompress(await download(runtime.core.url, runtime.core.sha256, MAX_SOURCE));
  const core = sourceEntries(coreBytes, 'core-libs');
  for (let index = 0; index < plan.packages.length; index++) {
    const pkg = plan.packages[index];
    progress({ stage: 'download', message: `Downloading ${pkg.name}-${pkg.version}.`, completed: index, total: plan.packages.length });
    let entries;
    if (pkg.source === 'core') entries = core.filter(entry => entry.path.startsWith(`${pkg.name}/`))
      .map(entry => ({ ...entry, path: entry.path.slice(pkg.name.length + 1) }));
    else {
      const bytes = await download(`/api/docs/objects/${pkg.archiveSha256}`, pkg.archiveSha256, pkg.archiveSize);
      entries = sourceEntries(await decompress(bytes, MAX_UNPACKED - total), `${pkg.name}-${pkg.version}`);
    }
    if (!entries.length) throw new Error(`The sources of ${pkg.name} are missing.`);
    for (const entry of entries) {
      total += entry.bytes.length;
      if (total > MAX_UNPACKED) throw new Error('The package sources exceed the memory limit.');
      fs.write(`/packages/${pkg.name}/${entry.path}`, entry.bytes);
    }
    const cabal = await download(`/api/docs/objects/${pkg.cabalSha256}`, pkg.cabalSha256, 1024 * 1024);
    fs.write(`/packages/${pkg.name}/${pkg.name}.cabal`, cabal);
  }
  fs.write('/plan.json', encode(JSON.stringify(plan)));
  progress({ stage: 'generate', message: `Generating documentation for ${plan.root.name}.` });
  let output = '';
  const decoders = {}; const pending = {};
  // The generator writes one "progress:" line before it documents each package.
  const line = text => {
    const message = text.startsWith('progress: ') ? text.slice(10) : null;
    if (message) progress({ stage: 'generate', message });
    else if (output.length < 64000) { output += `${text}\n`; log(text); }
  };
  const code = await runComponent(instantiate, path => compiled[path], {
    filesystem: fs, args: ['aihc-haddock', 'web-build', '/plan.json', '/docs.json', '/docs.txt'], cwd: '/', stdin: new Uint8Array(),
    onOutput: (stream, bytes) => {
      const lines = ((pending[stream] || '') + (decoders[stream] ||= new TextDecoder()).decode(bytes, { stream: true })).split('\n');
      pending[stream] = lines.pop(); lines.forEach(line);
    },
  });
  Object.values(pending).filter(Boolean).forEach(line);
  if (code !== 0) throw new Error(output.slice(-4000) || 'Documentation generation failed.');
  progress({ stage: 'generate', message: 'Checking the documentation model.' });
  const modelText = new TextDecoder().decode(fs.read('/docs.json'));
  const model = validateModel(JSON.parse(modelText), plan);
  progress({ stage: 'generate', message: `The documentation model is ready (${Math.ceil(modelText.length / 1024)} KiB).` });
  return { plan, modelText, model, hoogle: new TextDecoder().decode(fs.read('/docs.txt')), log: history.join('\n') };
}
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async event => {
    try {
      const result = await buildDocumentation(event.data.plan, { progress: event => self.postMessage(event) });
      self.postMessage({ type: 'result', result });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  };
}
