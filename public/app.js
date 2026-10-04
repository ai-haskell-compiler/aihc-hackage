import { haddock } from './haddock.js';

const view = document.querySelector('#view');
const home = document.querySelector('#home');
const status = document.querySelector('#status');
const queryInput = document.querySelector('#query');
const headerSearch = document.querySelector('#header-search');
const headerQuery = document.querySelector('#header-query');
const importDialog = document.querySelector('#import-dialog');
const importStatus = document.querySelector('#import-status');
const TABS = [
  ['description', 'Description'], ['readme', 'README'], ['api', 'API'],
  ['dependencies', 'Dependencies'], ['dependents', 'Dependents'], ['changelog', 'Changelog'], ['cabal', 'Cabal'],
];
const COMPONENT_NAMES = { library: 'Library', 'foreign-library': 'Foreign library', executable: 'Executable', 'test-suite': 'Test suite', benchmark: 'Benchmark' };
let requestNumber = 0;
let current = null;

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const encode = encodeURIComponent;
const packageHref = (name, version, tab) => `#package/${encode(name)}${version ? `/${encode(version)}` : ''}${tab && tab !== 'description' ? `/${tab}` : ''}`;
const searchHref = query => query ? `#search/${encode(query)}` : '#';
const link = (text, href, className) => { const node = element('a', text, className); node.href = href; return node; };
const externalLink = (text, href) => { const node = link(text, href); node.rel = 'nofollow noopener'; return node; };
function message(text, error = false) { status.textContent = text; status.className = error ? 'error' : ''; }
async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed.');
  return result;
}
function setTitle(text) { document.title = text ? `${text} · AIHC Hackage` : 'AIHC Hackage · Haskell packages'; }
function showPage(kind) {
  home.hidden = kind !== 'home';
  headerSearch.hidden = kind === 'home';
  document.body.dataset.page = kind;
}

async function catalogue(query, offset = 0) {
  const number = ++requestNumber;
  current = null;
  showPage('home'); setTitle(query);
  if (document.activeElement !== queryInput) queryInput.value = query;
  message('');
  try {
    const data = await api(`/api/packages?q=${encode(query)}&offset=${offset}`);
    if (number !== requestNumber) return;
    const label = element('h2', query ? 'Results for ' : 'Packages', 'section-label');
    if (query) label.append(element('span', query, 'query'));
    const list = element('ol', undefined, 'package-list');
    for (const pkg of data.packages) {
      const item = element('li');
      const card = link('', packageHref(pkg.name, pkg.version), 'package-card');
      const title = element('div', undefined, 'package-card-title');
      title.append(element('span', pkg.name, 'package-name'), element('span', pkg.version, 'badge'));
      card.append(title, element('p', pkg.synopsis || 'No synopsis in the Cabal file.'), element('span', pkg.license || 'License unspecified', 'card-meta'));
      item.append(card); list.append(item);
    }
    view.replaceChildren(label, list);
    if (!data.packages.length) {
      const empty = element('div', undefined, 'empty');
      empty.append(element('h3', query ? 'No imported package matches.' : 'The catalogue has no packages yet.'));
      const prompt = element('p', 'The site contains imported versions only. ');
      const button = element('button', 'Import a package from Hackage', 'link-button');
      button.type = 'button';
      button.onclick = () => openImport(/^[A-Za-z0-9-]+$/.test(query) ? query : '');
      prompt.append(button);
      empty.append(prompt);
      view.append(empty);
    }
    const pager = element('div', undefined, 'pager');
    if (offset > 0) { const previous = element('button', '← Previous', 'secondary'); previous.onclick = () => catalogue(query, Math.max(0, offset - 30)); pager.append(previous); }
    if (data.hasMore) { const next = element('button', 'Next →', 'secondary'); next.onclick = () => catalogue(query, offset + 30); pager.append(next); }
    if (pager.childElementCount) view.append(pager);
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
function componentName(component) {
  const [kind, ...rest] = component.split(':');
  const name = rest.join(':');
  if (kind === 'custom-setup') return 'Custom setup';
  if (kind === 'library' && name === 'main') return 'Library';
  return `${COMPONENT_NAMES[kind] || kind} ${name}`.trim();
}
function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return groups;
}
function note(text) { return element('p', text, 'note'); }
function emptyNote(text) { return element('p', text, 'empty-note'); }

function documentTab(pkg, kind) {
  const title = kind === 'readme' ? 'README' : 'changelog';
  const node = element('div');
  const record = pkg.documents?.[kind] || { status: 'not_imported' };
  if (record.status === 'available') {
    const href = `/api/${kind}/${encode(pkg.name)}/${encode(pkg.version)}`;
    const text = element('pre', 'Please wait for the document.', 'package-document');
    const actions = element('p', undefined, 'tab-actions');
    actions.append(link(`Open the ${title} as plain text ↗`, href));
    node.append(text, actions);
    current.documents ||= {};
    const cached = current.documents[kind];
    if (cached !== undefined) text.textContent = cached;
    else (async () => {
      try {
        const response = await fetch(href);
        if (!response.ok) throw new Error('The document is not available. Open the file link to try again.');
        text.textContent = current.documents[kind] = await response.text();
      } catch (error) { text.textContent = error.message; }
    })();
  } else if (record.status === 'missing') node.append(emptyNote(`Hackage does not have a ${title} file for this version.`));
  else {
    node.append(emptyNote(record.error || `The ${title} has not been imported.`));
    const retry = element('button', 'Import documents', 'secondary');
    retry.onclick = async () => {
      retry.disabled = true;
      try { await importVersion(pkg.name, pkg.version); }
      catch (error) { message(error.message, true); }
      finally { retry.disabled = false; }
    };
    node.append(retry);
  }
  return node;
}
function descriptionTab(pkg) {
  const text = (pkg.fields.description || []).join('\n');
  if (!text.trim()) return emptyNote('The Cabal file does not contain a description.');
  const node = element('div', undefined, 'prose');
  node.append(haddock(text, module => searchHref(module)));
  return node;
}
function apiTab(pkg) {
  const node = element('div');
  if (!pkg.exposedModules.length) return emptyNote('This package does not expose modules.');
  const list = element('ul', undefined, 'module-list');
  for (const name of [...pkg.exposedModules].sort()) { const item = element('li'); item.append(link(name, searchHref(name))); list.append(item); }
  node.append(note('This list includes modules from all conditional branches.'), list);
  return node;
}
function dependencyTable(rows, columns) {
  const table = element('table', undefined, 'dependency-table');
  const head = element('tr');
  for (const column of columns) head.append(element('th', column));
  const thead = element('thead'); thead.append(head);
  const body = element('tbody');
  for (const row of rows) {
    const tr = element('tr');
    for (const cell of row) { const td = element('td'); td.append(cell); tr.append(td); }
    body.append(tr);
  }
  table.append(thead, body);
  return table;
}
function dependenciesTab(pkg) {
  const node = element('div');
  if (!pkg.dependencies.length) return emptyNote('This package does not have package dependencies.');
  node.append(note('The lists include dependencies from all conditional branches.'));
  for (const [component, deps] of groupBy(pkg.dependencies, dep => dep.component)) {
    node.append(element('h3', componentName(component)));
    node.append(dependencyTable(deps.map(dep => [
      link(dep.package, packageHref(dep.package)), element('code', dep.range === '-any' ? 'any' : dep.range),
      dep.conditions.length ? element('code', dep.conditions.map(condition).join(' && '), 'condition') : '',
    ]), ['Package', 'Version range', 'Condition']));
  }
  return node;
}
function dependentsTab(reverse) {
  const node = element('div');
  if (!reverse.dependencies.length) return emptyNote('No imported package depends on this package.');
  node.append(note('These imported versions name this package. Their version ranges can exclude the selected version.'));
  const rows = [...groupBy(reverse.dependencies, dep => `${dep.name}\u0000${dep.version}`).values()].map(deps => {
    const components = element('div', undefined, 'components');
    for (const dep of deps) {
      const conditions = JSON.parse(dep.condition);
      const chip = element('span', `${componentName(dep.component)}: ${dep.version_range === '-any' ? 'any' : dep.version_range}`, 'chip');
      if (conditions.length) chip.title = `if ${conditions.map(condition).join(' && ')}`;
      components.append(chip);
    }
    return [link(`${deps[0].name}-${deps[0].version}`, packageHref(deps[0].name, deps[0].version)), components];
  });
  node.append(dependencyTable(rows, ['Package', 'Components and ranges']));
  if (reverse.truncated) node.append(note('The list shows the first 200 entries.'));
  return node;
}
function cabalTab(pkg) {
  const node = element('div');
  const actions = element('p', undefined, 'tab-actions');
  actions.append(link('Open the imported Cabal file ↗', `/api/cabal/${encode(pkg.name)}/${encode(pkg.version)}`));
  const table = element('dl', undefined, 'field-table');
  for (const [key, values] of Object.entries(pkg.fields)) {
    if (key === 'description') continue;
    table.append(element('dt', key), element('dd', values.join('\n')));
  }
  const disclosure = element('details', undefined, 'raw');
  disclosure.append(element('summary', 'Show the complete metadata as JSON'), element('pre', JSON.stringify(pkg, null, 2)));
  node.append(actions, table, disclosure);
  return node;
}

// Show "Name <email>" values with mail links. Show other text unchanged.
function people(value) {
  const node = element('div');
  const pattern = /([^<>,]*?)\s*<([^<>\s@]+@[^<>\s]+)>/g;
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    node.append(value.slice(last, match.index));
    const name = match[1].trim();
    if (name) { node.append(match[0].slice(0, match[0].indexOf(name)), link(name, `mailto:${match[2]}`)); }
    else node.append(link(match[2], `mailto:${match[2]}`));
    last = match.index + match[0].length;
  }
  node.append(value.slice(last));
  return node;
}
function fact(title, value) {
  const node = element('div', undefined, 'fact');
  node.append(element('dt', title));
  const dd = element('dd'); dd.append(value); node.append(dd);
  return node;
}
function sidebar(pkg) {
  const aside = element('aside', undefined, 'sidebar');
  const field = name => (pkg.fields[name] || []).join(', ').trim();
  const facts = element('section', undefined, 'panel');
  facts.append(element('h2', 'Package details'));
  const list = element('dl', undefined, 'facts');
  const homepage = field('homepage');
  list.append(
    fact('License', field('license') || 'Unspecified'),
    fact('Author', field('author') ? people(field('author')) : 'Not specified'),
    fact('Maintainer', field('maintainer') ? people(field('maintainer')) : 'Not specified'),
    fact('Homepage', /^https?:\/\//.test(homepage) ? externalLink(homepage.replace(/^https?:\/\//, '').replace(/\/$/, ''), homepage) : homepage || 'Not specified'),
    fact('Source', externalLink('View on Hackage ↗', `https://hackage.haskell.org/package/${pkg.name}-${pkg.version}`)),
    fact('Cabal file', link('View the imported file ↗', `/api/cabal/${encode(pkg.name)}/${encode(pkg.version)}`)),
  );
  facts.append(list); aside.append(facts);
  const versions = element('section', undefined, 'panel');
  versions.append(element('h2', 'Imported versions'));
  const versionLinks = element('div', undefined, 'version-links');
  for (const item of pkg.versions) {
    const node = link(item.version, packageHref(pkg.name, item.version, current.tab));
    if (item.version === pkg.version) node.setAttribute('aria-current', 'page');
    versionLinks.append(node);
  }
  versions.append(versionLinks); aside.append(versions);
  if (pkg.warnings.length) {
    const warnings = element('section', undefined, 'panel');
    warnings.append(element('h2', 'Parser warnings'));
    for (const warning of pkg.warnings) warnings.append(element('p', warning));
    aside.append(warnings);
  }
  return aside;
}
function tabCount(pkg, reverse, tab) {
  if (tab === 'api') return pkg.exposedModules.length;
  if (tab === 'dependencies') return new Set(pkg.dependencies.map(dep => dep.package)).size;
  if (tab === 'dependents') return new Set(reverse.dependencies.map(dep => dep.name)).size;
  return undefined;
}
function renderTab() {
  const { pkg, reverse, tab } = current;
  for (const node of view.querySelectorAll('.tabs a')) {
    if (node.dataset.tab === tab) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  }
  const panel = view.querySelector('.tab-panel');
  const builders = {
    description: () => descriptionTab(pkg), readme: () => documentTab(pkg, 'readme'), api: () => apiTab(pkg),
    dependencies: () => dependenciesTab(pkg), dependents: () => dependentsTab(reverse),
    changelog: () => documentTab(pkg, 'changelog'), cabal: () => cabalTab(pkg),
  };
  panel.replaceChildren(builders[tab]());
  panel.setAttribute('aria-label', TABS.find(([key]) => key === tab)[1]);
  for (const node of view.querySelectorAll('.version-links a')) {
    node.href = packageHref(pkg.name, node.textContent, tab);
  }
}
function renderPackage() {
  const { pkg, reverse } = current;
  const head = element('div', undefined, 'package-head');
  head.append(link('← All packages', '#', 'back'));
  const title = element('h1', pkg.name, 'package-title');
  title.append(element('span', pkg.version, 'badge'));
  head.append(title);
  head.append(element('p', (pkg.fields.synopsis || ['No synopsis in the Cabal file.']).join(' '), 'lede'));
  const tabs = element('nav', undefined, 'tabs');
  tabs.setAttribute('aria-label', 'Package sections');
  for (const [key, label] of TABS) {
    const node = link(label, packageHref(pkg.name, current.version, key));
    node.dataset.tab = key;
    const count = tabCount(pkg, reverse, key);
    if (count !== undefined) node.append(element('span', String(count), 'count'));
    tabs.append(node);
  }
  const layout = element('div', undefined, 'package-layout');
  const main = element('div', undefined, 'package-main');
  const panel = element('section', undefined, 'tab-panel');
  main.append(tabs, panel);
  layout.append(main, sidebar(pkg));
  view.replaceChildren(head, layout);
  renderTab();
}
async function detail(name, version, tab) {
  showPage('package');
  if (current && current.name === name && current.version === version) {
    current.tab = tab; renderTab(); return;
  }
  const number = ++requestNumber;
  current = null;
  setTitle(name);
  message('Please wait for the package metadata.');
  view.replaceChildren();
  try {
    const [pkg, reverse] = await Promise.all([
      api(`/api/packages/${encode(name)}${version ? `/${encode(version)}` : ''}`),
      api(`/api/reverse/${encode(name)}`),
    ]);
    if (number !== requestNumber) return;
    current = { name, version, tab, pkg, reverse };
    setTitle(`${pkg.name}-${pkg.version}`);
    message('');
    renderPackage();
  } catch (error) {
    if (number !== requestNumber) return;
    message('');
    const empty = element('div', undefined, 'empty');
    empty.append(element('h3', error.message));
    const prompt = element('p', 'The site contains imported versions only. ');
    const button = element('button', `Import ${name} from Hackage`, 'link-button');
    button.type = 'button';
    button.onclick = () => openImport(name, version);
    prompt.append(button);
    empty.append(prompt);
    view.replaceChildren(link('← All packages', '#', 'back'), empty);
  }
}

function route() {
  const tabNames = TABS.map(([key]) => key).join('|');
  const pkg = new RegExp(`^#package/([^/]+)(?:/([0-9][^/]*))?(?:/(${tabNames}))?$`).exec(location.hash);
  const search = /^#search\/(.*)$/.exec(location.hash);
  try {
    if (pkg) detail(decodeURIComponent(pkg[1]), pkg[2] && decodeURIComponent(pkg[2]), pkg[3] || 'description');
    else catalogue(search ? decodeURIComponent(search[1]) : '', 0);
  } catch { message('The link is not valid.', true); }
}
function search(query, replace = false) {
  const href = searchHref(query.trim());
  if (location.hash === href || (!location.hash && href === '#')) { catalogue(query.trim(), 0); return; }
  if (replace) { history.replaceState(null, '', href === '#' ? location.pathname : href); catalogue(query.trim(), 0); }
  else location.hash = href;
}
let searchTimer;
queryInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(queryInput.value, true), 250);
});
document.querySelector('#search-form').onsubmit = event => { event.preventDefault(); clearTimeout(searchTimer); search(queryInput.value); };
headerSearch.onsubmit = event => { event.preventDefault(); const query = headerQuery.value; headerQuery.value = ''; headerQuery.blur(); search(query); };

function openImport(name = '', version = '') {
  document.querySelector('#import-name').value = name;
  document.querySelector('#import-version').value = version || '';
  importStatus.textContent = ''; importStatus.className = 'muted';
  importDialog.showModal();
  document.querySelector(name ? '#import-version' : '#import-name').focus();
}
async function importVersion(name, version) {
  const result = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, version }) });
  current = null;
  const href = packageHref(result.name, result.version);
  if (location.hash === href) await detail(result.name, result.version, 'description'); else location.hash = href;
}
document.querySelector('#open-import').onclick = () => openImport();
document.querySelector('#import-cancel').onclick = () => importDialog.close();
importDialog.addEventListener('click', event => { if (event.target === importDialog) importDialog.close(); });
document.querySelector('#import-form').onsubmit = async event => {
  event.preventDefault();
  const button = document.querySelector('#import-button'); button.disabled = true;
  const name = document.querySelector('#import-name').value.trim();
  const version = document.querySelector('#import-version').value.trim();
  importStatus.textContent = `Importing ${name}-${version} from Hackage. Please wait.`; importStatus.className = 'muted';
  try { await importVersion(name, version); importDialog.close(); }
  catch (error) { importStatus.textContent = error.message; importStatus.className = 'error'; }
  finally { button.disabled = false; }
};
window.addEventListener('hashchange', route);
route();
