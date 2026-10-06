import { readTar } from './tar.js';

const base = '/shell/haddock';
async function download(name) {
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) throw new Error('The aihc-haddock files could not be loaded.');
  return response;
}
const gunzip = async response => new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());

// Compile the component once, and send the compiled modules to each process.
export async function loadHaddock(status) {
  status('Loading aihc-haddock…');
  if (typeof WebAssembly.Suspending !== 'function') throw new Error('This browser does not support WebAssembly JSPI, which aihc-haddock needs.');
  const names = await (await download('modules.json')).json();
  const [coreLibs, ...compiled] = await Promise.all([
    download('core-libs.tar.gz').then(gunzip),
    ...names.map(async name => WebAssembly.compile(await gunzip(await download(`${name}.gz`)))),
  ]);
  status('aihc-haddock ready');
  return { modules: Object.fromEntries(names.map((name, index) => [name, compiled[index]])), coreLibs };
}

const PACKAGE = /^(?=.{1,128}$)([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)-(\d{1,9}(?:\.\d{1,9})*)$/;
const MAX_UNPACKED = 128 * 1024 * 1024;

// Download one package version through the site and unpack its source into the directory.
export async function getPackage(identifier, directory, fs) {
  if (!PACKAGE.test(identifier)) throw new Error('Enter a package and a version, for example text-2.1.4.');
  const response = await fetch(`/hackage/package/${identifier}/${identifier}.tar.gz`);
  if (!response.ok) {
    const message = (await response.json().catch(() => ({}))).error;
    throw new Error(message || `Hackage did not return ${identifier}.`);
  }
  const entries = readTar(await gunzip(response));
  let total = 0;
  for (const entry of entries) {
    if (!entry.path.startsWith(`${identifier}/`) && entry.path !== identifier) throw new Error('The package archive is not valid.');
    const path = `${directory}/${entry.path}`;
    if (entry.kind === 'directory') fs.mkdir(path, true);
    else {
      total += entry.bytes.length;
      if (total > MAX_UNPACKED) throw new Error('The package source exceeds the size limit.');
      fs.mkdir(path.slice(0, path.lastIndexOf('/')), true);
      fs.write(path, entry.bytes);
    }
  }
  return entries.filter(entry => entry.kind === 'file').length;
}
