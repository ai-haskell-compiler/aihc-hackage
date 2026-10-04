// Render the site pages as HTML text.
import { html, raw, render, escape } from './html.js';
import { markdown } from './markdown.js';
import { haddock } from './haddock.js';

export const SITE = 'AIHC Hackage';
export const TABS = [
  ['description', 'Description'], ['readme', 'README'], ['api', 'API'],
  ['dependencies', 'Dependencies'], ['dependents', 'Dependents'], ['changelog', 'Changelog'], ['cabal', 'Cabal'],
];
export const TAB_NAMES = TABS.map(([key]) => key);
const COMPONENT_NAMES = { library: 'Library', 'foreign-library': 'Foreign library', executable: 'Executable', 'test-suite': 'Test suite', benchmark: 'Benchmark' };
const encode = encodeURIComponent;
export const packageHref = (name, version, tab) => `/package/${encode(name)}${version ? `/${encode(version)}` : ''}${tab ? `/${tab}` : ''}`;
export const searchHref = (query, offset = 0) => {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (offset) params.set('offset', String(offset));
  const text = params.toString();
  return query ? `/search?${text}` : `/${text ? `?${text}` : ''}`;
};
// Show the README first if it is available. Otherwise show the description.
export const defaultTab = pkg => pkg.documents?.readme?.status === 'available' ? 'readme' : 'description';

const MARK = raw('<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs><clipPath id="mark-clip"><polygon points="18,18 62,18 40,88"/></clipPath></defs><g fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><path d="M24 54 Q40 36 56 54" clip-path="url(#mark-clip)" stroke-linecap="butt"/><path d="M18 18 L40 88 L62 18"/><path d="M64 88 L79.1 40"/><circle cx="86" cy="18" r="6" fill="currentColor" stroke="none"/></g></svg>');
const SEARCH_ICON = raw('<svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>');
const DEFAULT_DESCRIPTION = 'Search Haskell package metadata, modules, dependencies, READMEs, and changelogs.';

// Render a complete page. The content is the main section of the page.
export function layout({ title, description = DEFAULT_DESCRIPTION, canonical, noindex = false, page, query = '', content }) {
  const fullTitle = title ? `${title} · ${SITE}` : `${SITE} · Haskell packages`;
  const home = page === 'home';
  return `<!doctype html>\n${render(html`<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#faf8f3" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#151318" media="(prefers-color-scheme: dark)">
  <meta name="description" content="${description}">
  ${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}
  ${noindex ? raw('<meta name="robots" content="noindex">') : ''}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${SITE}">
  <meta property="og:title" content="${title || `${SITE} · Haskell packages`}">
  <meta property="og:description" content="${description}">
  ${canonical ? html`<meta property="og:url" content="${canonical}">` : ''}
  <meta name="twitter:card" content="summary">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <title>${fullTitle}</title>
  <link rel="preload" href="/fonts/inter.3100e775.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/fonts/newsreader.6e4f2958.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/style.css">
  <script src="/theme.js"></script>
  <script type="module" src="/app.js"></script>
</head>
<body data-page="${page}">
  <a class="skip" href="#content">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="/"><span class="mark">${MARK}</span><span>AIHC <strong>Hackage</strong></span></a>
    <form class="header-search" role="search" action="/search" method="get"${home ? raw(' hidden') : ''}><label class="visually-hidden" for="header-query">Search packages</label><input id="header-query" name="q" type="search" maxlength="200" placeholder="Search packages…" autocomplete="off"></form>
    <nav aria-label="Main"><a href="/"${home ? raw(' aria-current="page"') : ''}>Packages</a><a href="/shell/">Shell</a><a href="https://docs.aihc.app/">Manual<span aria-hidden="true"> ↗</span></a><button id="theme" class="icon-button" type="button" title="Use the light mode"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d=""/></svg></button></nav>
  </header>
  <main id="content" tabindex="-1">
    ${home ? html`<section id="home" class="home">
      <h1>Find a <em>Haskell</em> package.</h1>
      <form id="search-form" class="search" role="search" action="/search" method="get"><label class="visually-hidden" for="query">Search packages and modules</label>${SEARCH_ICON}<input id="query" name="q" type="search" maxlength="200" placeholder="Package or module name" autocomplete="off" autofocus value="${query}"><button>Search</button></form>
      <p class="hint">Search package names, synopses, and exposed modules such as <a href="/search?q=Data.Text">Data.Text</a>.</p>
    </section>` : ''}
    <p id="status" role="status" aria-live="polite"></p>
    <section id="view">${content}</section>
  </main>
  <footer class="site-footer"><p>AIHC Hackage · Metadata from <a href="https://hackage.haskell.org">Hackage</a></p><nav aria-label="Footer"><button id="open-import" class="link-button" type="button">Import a package</button><a href="https://blog.aihc.app/">Journal</a><a href="https://github.com/ai-haskell-compiler/aihc-hackage">Source</a></nav></footer>
  <dialog id="import-dialog" aria-labelledby="import-title">
    <form id="import-form">
      <h2 id="import-title">Import a package</h2>
      <p>Enter a package name and an exact version from Hackage. The site contains imported versions only.</p>
      <label>Package name<input id="import-name" required maxlength="128" placeholder="text" autocomplete="off"></label>
      <label>Version<input id="import-version" required maxlength="128" placeholder="2.1.4" autocomplete="off"></label>
      <p id="import-status" class="muted" role="status" aria-live="polite"></p>
      <div class="dialog-actions"><button id="import-cancel" class="secondary" type="button">Cancel</button><button id="import-button">Import</button></div>
    </form>
  </dialog>
</body>
</html>`)}`;
}

const importButton = (text, name = '', version = '', className = 'link-button') =>
  html`<button class="${className}" type="button" data-import-name="${name}" data-import-version="${version}">${text}</button>`;

// Render the package list for the home page and the search page.
export function catalogue({ query, offset, packages, hasMore }) {
  const label = query ? html`<h2 class="section-label">Results for <span class="query">${query}</span></h2>` : raw('<h2 class="section-label">Packages</h2>');
  const list = html`<ol class="package-list">${packages.map(pkg => html`<li><a class="package-card" href="${packageHref(pkg.name, pkg.version)}">
    <div class="package-card-title"><span class="package-name">${pkg.name}</span><span class="badge">${pkg.version}</span></div>
    <p>${pkg.synopsis || 'No synopsis in the Cabal file.'}</p><span class="card-meta">${pkg.license || 'License unspecified'}</span></a></li>`)}</ol>`;
  const empty = packages.length ? '' : html`<div class="empty"><h3>${query ? 'No imported package matches.' : 'The catalogue has no packages yet.'}</h3>
    <p>The site contains imported versions only. ${importButton('Import a package from Hackage', /^[A-Za-z0-9-]+$/.test(query) ? query : '')}</p></div>`;
  const previous = offset > 0 ? html`<a class="secondary" href="${searchHref(query, Math.max(0, offset - 30))}">← Previous</a>` : '';
  const next = hasMore ? html`<a class="secondary" href="${searchHref(query, offset + 30)}">Next →</a>` : '';
  const pager = previous || next ? html`<div class="pager">${previous}${next}</div>` : '';
  return html`<div id="results">${label}${list}${empty}${pager}</div>`;
}
export function cataloguePage({ origin, query, offset, packages, hasMore }) {
  return layout({
    title: query, page: 'home', query, canonical: query ? undefined : `${origin}/`, noindex: Boolean(query) || offset > 0,
    content: catalogue({ query, offset, packages, hasMore }),
  });
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
const note = text => html`<p class="note">${text}</p>`;
const emptyNote = text => html`<p class="empty-note">${text}</p>`;
const externalLink = (text, href) => html`<a href="${href}" rel="nofollow noopener">${text}</a>`;

// Render a README as Markdown and a changelog as plain text. The text is null when the saved document is not available.
function documentTab(pkg, kind, text) {
  const title = kind === 'readme' ? 'README' : 'changelog';
  const record = pkg.documents?.[kind] || { status: 'not_imported' };
  if (record.status === 'available') {
    const href = `/api/${kind}/${encode(pkg.name)}/${encode(pkg.version)}`;
    let body;
    if (text === null) body = emptyNote('The document is not available. Open the file link to try again.');
    else if (kind === 'readme') body = html`<div class="prose markdown">${raw(markdown(text))}</div>`;
    else body = html`<pre class="package-document">${text}</pre>`;
    return html`<div>${body}<p class="tab-actions"><a href="${href}">Open the ${title} as plain text ↗</a></p></div>`;
  }
  if (record.status === 'missing') return emptyNote(`Hackage does not have a ${title} file for this version.`);
  return html`<div>${emptyNote(record.error || `The ${title} has not been imported.`)}
    <button class="secondary" type="button" data-import-name="${pkg.name}" data-import-version="${pkg.version}" data-import-reload>Import documents</button></div>`;
}
function descriptionTab(pkg) {
  const text = (pkg.fields.description || []).join('\n');
  if (!text.trim()) return emptyNote('The Cabal file does not contain a description.');
  return html`<div class="prose">${raw(haddock(text, module => searchHref(module)))}</div>`;
}
function apiTab(pkg) {
  if (!pkg.exposedModules.length) return emptyNote('This package does not expose modules.');
  return html`<div>${note('This list includes modules from all conditional branches.')}
    <ul class="module-list">${[...pkg.exposedModules].sort().map(name => html`<li>${name}</li>`)}</ul></div>`;
}
function dependencyTable(rows, columns) {
  return html`<table class="dependency-table"><thead><tr>${columns.map(column => html`<th>${column}</th>`)}</tr></thead>
    <tbody>${rows.map(row => html`<tr>${row.map(cell => html`<td>${cell}</td>`)}</tr>`)}</tbody></table>`;
}
function dependenciesTab(pkg) {
  if (!pkg.dependencies.length) return emptyNote('This package does not have package dependencies.');
  const groups = [...groupBy(pkg.dependencies, dep => dep.component)].map(([component, deps]) => html`<h3>${componentName(component)}</h3>
    ${dependencyTable(deps.map(dep => [
      html`<a href="${packageHref(dep.package)}">${dep.package}</a>`, html`<code>${dep.range === '-any' ? 'any' : dep.range}</code>`,
      dep.conditions.length ? html`<code class="condition">${dep.conditions.map(condition).join(' && ')}</code>` : '',
    ]), ['Package', 'Version range', 'Condition'])}`);
  return html`<div>${note('The lists include dependencies from all conditional branches.')}${groups}</div>`;
}
function dependentsTab(reverse) {
  if (!reverse.dependencies.length) return emptyNote('No imported package depends on this package.');
  const rows = [...groupBy(reverse.dependencies, dep => `${dep.name}\u0000${dep.version}`).values()].map(deps => {
    const chips = deps.map(dep => {
      const conditions = JSON.parse(dep.condition);
      const title = conditions.length ? html` title="if ${conditions.map(condition).join(' && ')}"` : '';
      return html`<span class="chip"${title}>${componentName(dep.component)}: ${dep.version_range === '-any' ? 'any' : dep.version_range}</span>`;
    });
    return [html`<a href="${packageHref(deps[0].name, deps[0].version)}">${deps[0].name}-${deps[0].version}</a>`, html`<div class="components">${chips}</div>`];
  });
  return html`<div>${note('These imported versions name this package. Their version ranges can exclude the selected version.')}
    ${dependencyTable(rows, ['Package', 'Components and ranges'])}
    ${reverse.truncated ? note('The list shows the first 200 entries.') : ''}</div>`;
}
function cabalTab(pkg) {
  const fields = Object.entries(pkg.fields).filter(([key]) => key !== 'description')
    .map(([key, values]) => html`<dt>${key}</dt><dd>${values.join('\n')}</dd>`);
  return html`<div><p class="tab-actions"><a href="/api/cabal/${encode(pkg.name)}/${encode(pkg.version)}">Open the imported Cabal file ↗</a></p>
    <dl class="field-table">${fields}</dl>
    <details class="raw"><summary>Show the complete metadata as JSON</summary><pre>${JSON.stringify(pkg, null, 2)}</pre></details></div>`;
}

// Show "Name <email>" values with mail links. Show other text unchanged.
function people(value) {
  const parts = [];
  const pattern = /([^<>,]*?)\s*<([^<>\s@]+@[^<>\s]+)>/g;
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    parts.push(value.slice(last, match.index));
    const name = match[1].trim();
    if (name) parts.push(match[0].slice(0, match[0].indexOf(name)), html`<a href="mailto:${match[2]}">${name}</a>`);
    else parts.push(html`<a href="mailto:${match[2]}">${match[2]}</a>`);
    last = match.index + match[0].length;
  }
  parts.push(value.slice(last));
  return html`<div>${parts}</div>`;
}
const fact = (title, value) => html`<div class="fact"><dt>${title}</dt><dd>${value}</dd></div>`;
function sidebar(pkg, tab) {
  const field = name => (pkg.fields[name] || []).join(', ').trim();
  const homepage = field('homepage');
  const facts = html`<section class="panel"><h2>Package details</h2><dl class="facts">
    ${fact('License', field('license') || 'Unspecified')}
    ${fact('Author', field('author') ? people(field('author')) : 'Not specified')}
    ${fact('Maintainer', field('maintainer') ? people(field('maintainer')) : 'Not specified')}
    ${fact('Homepage', /^https?:\/\//.test(homepage) ? externalLink(homepage.replace(/^https?:\/\//, '').replace(/\/$/, ''), homepage) : homepage || 'Not specified')}
    ${fact('Source', externalLink('View on Hackage ↗', `https://hackage.haskell.org/package/${pkg.name}-${pkg.version}`))}
  </dl></section>`;
  const versions = html`<section class="panel"><h2>Imported versions</h2><div class="version-links">${pkg.versions.map(item =>
    html`<a href="${packageHref(pkg.name, item.version, tab)}"${item.version === pkg.version ? raw(' aria-current="page"') : ''}>${item.version}</a>`)}</div></section>`;
  const warnings = pkg.warnings.length ? html`<section class="panel"><h2>Parser warnings</h2>${pkg.warnings.map(warning => html`<p>${warning}</p>`)}</section>` : '';
  return html`<aside class="sidebar">${facts}${versions}${warnings}</aside>`;
}
function tabCount(pkg, reverse, tab) {
  if (tab === 'api') return pkg.exposedModules.length;
  if (tab === 'dependencies') return new Set(pkg.dependencies.map(dep => dep.package)).size;
  if (tab === 'dependents') return new Set(reverse.dependencies.map(dep => dep.name)).size;
  return undefined;
}

// Render a package page. The tab is the tab from the URL, or undefined for the default tab.
// The documents object contains the saved README or changelog text for the active tab.
export function packagePage({ origin, pkg, reverse, tab, documents = {} }) {
  const active = tab || defaultTab(pkg);
  const builders = {
    description: () => descriptionTab(pkg), readme: () => documentTab(pkg, 'readme', documents.readme), api: () => apiTab(pkg),
    dependencies: () => dependenciesTab(pkg), dependents: () => dependentsTab(reverse),
    changelog: () => documentTab(pkg, 'changelog', documents.changelog), cabal: () => cabalTab(pkg),
  };
  const tabs = TABS.map(([key, label]) => {
    const count = tabCount(pkg, reverse, key);
    return html`<a href="${packageHref(pkg.name, pkg.version, key)}" data-tab="${key}"${key === active ? raw(' aria-current="page"') : ''}>${label}${count !== undefined ? html`<span class="count">${count}</span>` : ''}</a>`;
  });
  const synopsis = (pkg.fields.synopsis || []).join(' ');
  const content = html`<div class="package-head"><a class="back" href="/">← All packages</a>
    <h1 class="package-title">${pkg.name}<span class="badge">${pkg.version}</span></h1>
    <p class="lede">${synopsis || 'No synopsis in the Cabal file.'}</p></div>
    <div class="package-layout"><div class="package-main"><nav class="tabs" aria-label="Package sections">${tabs}</nav>
    <section class="tab-panel" aria-label="${TABS.find(([key]) => key === active)[1]}">${builders[active]()}</section></div>${sidebar(pkg, tab)}</div>`;
  return layout({
    title: `${pkg.name}-${pkg.version}`, page: 'package', content,
    description: synopsis || `Metadata, dependencies, and documents for the Haskell package ${pkg.name}-${pkg.version}.`,
    canonical: origin + packageHref(pkg.name, pkg.version, active === defaultTab(pkg) ? undefined : active),
  });
}

// Render the page for a package or version that is not imported.
export function missingPackagePage({ name, version, message }) {
  const content = html`<a class="back" href="/">← All packages</a><div class="empty"><h3>${message}</h3>
    <p>The site contains imported versions only. ${importButton(`Import ${name} from Hackage`, name, version || '')}</p></div>`;
  return layout({ title: version ? `${name}-${version}` : name, page: 'package', noindex: true, content });
}
export function errorPage(message) {
  const content = html`<a class="back" href="/">← All packages</a><div class="empty"><h3>${message}</h3></div>`;
  return layout({ title: 'Error', page: 'package', noindex: true, content });
}

export function sitemap(origin, releases) {
  const entries = releases.map(release => `<url><loc>${escape(origin + packageHref(release.name, release.version))}</loc><lastmod>${escape(release.imported_at.slice(0, 10))}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(origin)}/</loc></url>${entries.join('')}</urlset>\n`;
}
export const robots = origin => `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /search\nSitemap: ${origin}/sitemap.xml\n`;
