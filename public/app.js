const content = document.querySelector('#content');
const status = document.querySelector('#status');
const queryInput = document.querySelector('#query');
let requestNumber = 0;
let catalogueQuery = '';
let catalogueOffset = 0;
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const packageHref = (name, version) => `#package/${encodeURIComponent(name)}${version ? `/${encodeURIComponent(version)}` : ''}`;
const link = (text, href, className) => { const node = element('a', text, className); node.href = href; return node; };
function message(text, error = false) { status.textContent = text; status.className = error ? 'error' : ''; }
async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed.');
  return result;
}
function heading(title, note) {
  const node = element('div', undefined, 'section-heading');
  node.append(element('h2', title));
  if (note) node.append(element('span', note, 'muted'));
  return node;
}
async function catalogue(query = '', offset = 0) {
  const number = ++requestNumber;
  catalogueQuery = query; catalogueOffset = offset;
  queryInput.value = query;
  message('Please wait for the catalogue.');
  try {
    const data = await api(`/api/packages?q=${encodeURIComponent(query)}&offset=${offset}`);
    if (number !== requestNumber) return;
    content.replaceChildren(heading(query ? `Results for “${query}”` : 'Imported packages', 'LATEST IMPORTED VERSIONS'));
    const list = element('div', undefined, 'package-list');
    for (const pkg of data.packages) {
      const card = element('article', undefined, 'package-card');
      card.append(link(pkg.name, packageHref(pkg.name, pkg.version), 'package-name'), element('span', pkg.version, 'badge'),
        element('p', pkg.synopsis || 'No synopsis in the Cabal file.'), element('span', pkg.license || 'License unspecified', 'card-meta'));
      list.append(card);
    }
    if (!data.packages.length) {
      const empty = element('div', undefined, 'empty');
      empty.append(element('h3', query ? 'No imported package matches.' : 'The catalogue is ready for its first package.'),
        element('p', 'Use “Import a package” to add a version from Hackage.'));
      list.append(empty);
    }
    content.append(list);
    const pager = element('div', undefined, 'pager');
    if (offset > 0) { const previous = element('button', 'Previous'); previous.onclick = () => catalogue(query, Math.max(0, offset - 30)); pager.append(previous); }
    if (data.hasMore) { const next = element('button', 'Next'); next.onclick = () => catalogue(query, offset + 30); pager.append(next); }
    content.append(pager); message('');
  } catch (error) { if (number === requestNumber) message(error.message, true); }
}
function condition(value) {
  if ('literal' in value) return String(value.literal);
  if (value.os) return `os(${value.os})`;
  if (value.arch) return `arch(${value.arch})`;
  if (value.flag) return `flag(${value.flag})`;
  if (value.compiler) return `impl(${value.compiler} ${value.range})`;
  if (value.not) return `!(${condition(value.not)})`;
  if (value.and) return value.and.map(condition).join(' && ');
  if (value.or) return `(${value.or.map(condition).join(' || ')})`;
  return '';
}
function dependencyRow(dep, reverse = false) {
  const node = element('div', undefined, 'dependency-row');
  node.append(link(reverse ? `${dep.name}-${dep.version}` : dep.package, packageHref(reverse ? dep.name : dep.package, reverse ? dep.version : undefined)),
    element('code', reverse ? dep.version_range : dep.range));
  const conditions = reverse ? JSON.parse(dep.condition) : dep.conditions;
  node.append(element('small', `${dep.component}${conditions.length ? ` · if ${conditions.map(condition).join(' && ')}` : ''}`));
  return node;
}
function panel(title) { const node = element('section', undefined, 'panel'); node.append(element('h3', title)); return node; }
function fact(title, value) { const node = element('div', undefined, 'fact'); node.append(element('span', title), typeof value === 'string' ? element('div', value) : value); return node; }
async function detail(name, version) {
  const number = ++requestNumber;
  message('Please wait for the package metadata.');
  try {
    const pkg = await api(`/api/packages/${encodeURIComponent(name)}${version ? `/${encodeURIComponent(version)}` : ''}`);
    const reverse = await api(`/api/reverse/${encodeURIComponent(name)}`);
    if (number !== requestNumber) return;
    const title = element('h2', pkg.name, 'package-title'); title.append(element('span', pkg.version, 'badge'));
    content.replaceChildren(link('← Package catalogue', '#', 'back'), heading('Package metadata'), title);
    const grid = element('div', undefined, 'detail-grid');
    const main = element('div'); const aside = element('aside');
    const description = panel((pkg.fields.synopsis || ['Package description']).join('\n'));
    description.append(element('p', (pkg.fields.description || ['No description in the Cabal file.']).join('\n'))); main.append(description);
    const modules = panel('Exposed modules');
    modules.append(element('p', 'This list includes modules from all conditional branches.', 'condition-note'));
    const moduleList = element('ul', undefined, 'module-list');
    for (const name of pkg.exposedModules) moduleList.append(element('li', name));
    modules.append(pkg.exposedModules.length ? moduleList : element('p', 'No exposed modules.')); main.append(modules);
    const deps = panel('Dependencies');
    deps.append(element('p', 'Dependencies include all branches. Conditions appear below each link.', 'condition-note'));
    for (const dep of pkg.dependencies) deps.append(dependencyRow(dep));
    if (!pkg.dependencies.length) deps.append(element('p', 'No package dependencies.')); main.append(deps);
    const reversePanel = panel('Reverse dependencies');
    reversePanel.append(element('p', 'These imported versions name this package. Version ranges can exclude the selected version.', 'condition-note'));
    for (const dep of reverse.dependencies) reversePanel.append(dependencyRow(dep, true));
    if (!reverse.dependencies.length) reversePanel.append(element('p', 'No imported package depends on this package.'));
    if (reverse.truncated) reversePanel.append(element('p', 'The list shows the first 200 entries.')); main.append(reversePanel);
    const fields = panel('Package fields'); const table = element('dl', undefined, 'field-table');
    for (const [key, values] of Object.entries(pkg.fields)) table.append(element('dt', key), element('dd', values.join('\n')));
    fields.append(table); main.append(fields);
    const full = panel('Complete metadata'); const disclosure = element('details');
    disclosure.append(element('summary', 'View components, flags, and conditions'), element('pre', JSON.stringify(pkg, null, 2)));
    full.append(disclosure); main.append(full);
    const facts = panel('Package details');
    facts.append(fact('License', (pkg.fields.license || ['Unspecified']).join(', ')), fact('Cabal format', pkg.cabalVersion), fact('Build type', pkg.buildType),
      fact('Imported', new Date(pkg.importedAt).toLocaleString()), fact('Source', link('View on Hackage ↗', `https://hackage.haskell.org/package/${pkg.name}-${pkg.version}`)),
      fact('Cabal file', link('View imported Cabal file ↗', `/api/cabal/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`)));
    aside.append(facts);
    const versions = panel('Imported versions'); const versionLinks = element('div', undefined, 'version-links');
    for (const item of pkg.versions) versionLinks.append(link(item.version, packageHref(name, item.version)));
    versions.append(versionLinks); aside.append(versions);
    if (pkg.warnings.length) { const warnings = panel('Parser warnings'); for (const warning of pkg.warnings) warnings.append(element('p', warning)); aside.append(warnings); }
    grid.append(main, aside); content.append(grid); message('');
  } catch (error) {
    if (number !== requestNumber) return;
    content.replaceChildren(link('← Package catalogue', '#', 'back'), heading(name), element('p', error.message));
    document.querySelector('#import-panel').open = true;
    document.querySelector('#import-name').value = name;
    document.querySelector('#import-version').value = version || '';
    message(error.message, true);
  }
}
function route() {
  const match = /^#package\/([^/]+)(?:\/([^/]+))?$/.exec(location.hash);
  if (match) {
    try { detail(decodeURIComponent(match[1]), match[2] && decodeURIComponent(match[2])); }
    catch { message('The package link is invalid.', true); }
  } else catalogue(catalogueQuery, catalogueOffset);
}
document.querySelector('#search-form').onsubmit = event => {
  event.preventDefault(); catalogueQuery = queryInput.value.trim(); catalogueOffset = 0;
  if (location.hash) location.hash = ''; else catalogue(catalogueQuery);
};
document.querySelector('#import-form').onsubmit = async event => {
  event.preventDefault(); const button = document.querySelector('#import-button'); button.disabled = true;
  const name = document.querySelector('#import-name').value.trim(); const version = document.querySelector('#import-version').value.trim();
  message(`Import ${name}-${version} from Hackage. Please wait.`);
  try {
    const result = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, version }) });
    const href = packageHref(result.name, result.version);
    if (location.hash === href) await detail(result.name, result.version); else location.hash = href;
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; }
};
window.addEventListener('hashchange', route);
route();
