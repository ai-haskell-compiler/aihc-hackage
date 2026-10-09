import { html, raw, render } from '../src/html.js';

const array = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value : '';
const id = (namespace, name) => `decl-${encodeURIComponent(text(namespace))}-${encodeURIComponent(text(name))}`;
function plain(doc) {
  if (!doc || typeof doc !== 'object') return '';
  if (doc.string) return text(doc.string);
  if (doc.name) return text(doc.name);
  return [doc.document, doc.first, doc.second, ...array(doc.documents)].map(plain).join('');
}
export function docMarkup(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const inner = () => docMarkup(doc.document);
  switch (doc.tag) {
    case 'DocEmpty': return '';
    case 'DocString': return text(doc.string);
    case 'DocAppend': return html`${docMarkup(doc.first)}${docMarkup(doc.second)}`;
    case 'DocParagraph': return html`<p>${inner()}</p>`;
    case 'DocEmphasis': return html`<em>${inner()}</em>`;
    case 'DocBold': return html`<strong>${inner()}</strong>`;
    case 'DocWarning': return html`<aside class="doc-warning">${inner()}</aside>`;
    case 'DocMonospaced': return html`<code>${inner()}</code>`;
    case 'DocCodeBlock': return html`<pre><code>${plain(doc.document)}</code></pre>`;
    case 'DocIdentifier': case 'DocIdentifierUnchecked': return html`<code>${text(doc.name)}</code>`;
    case 'DocModule': return html`<code>${text(doc.string)}</code>`;
    case 'DocUnorderedList': return html`<ul>${array(doc.documents).map(item => html`<li>${docMarkup(item)}</li>`)}</ul>`;
    case 'DocOrderedList': return html`<ol>${array(doc.items).map(item => html`<li>${docMarkup(item?.document)}</li>`)}</ol>`;
    case 'DocDefList': return html`<dl>${array(doc.definitions).map(item => html`<dt>${docMarkup(item?.document)}</dt><dd>${docMarkup(item?.y)}</dd>`)}</dl>`;
    case 'DocHyperlink': {
      const url = text(doc.hyperlink?.hyperlinkUrl);
      const label = doc.hyperlink?.hyperlinkLabel ? docMarkup(doc.hyperlink.hyperlinkLabel) : url;
      return /^https?:\/\//i.test(url) ? html`<a href="${url}" rel="nofollow noreferrer">${label}</a>` : label;
    }
    case 'DocPic': return html`<span class="muted">${text(doc.picture?.pictureLabel) || 'Image omitted.'}</span>`;
    case 'DocHeader': return html`<h3>${docMarkup(doc.header?.headerTitle)}</h3>`;
    case 'DocExamples': return html`<pre><code>${array(doc.examples).map(example => `${text(example?.expression)}\n${array(example?.result).map(text).join('\n')}`).join('\n\n')}</code></pre>`;
    case 'DocProperty': case 'DocMathInline': case 'DocMathDisplay': return html`<code>${text(doc.string)}</code>`;
    case 'DocAName': return '';
    case 'DocTable': return html`<p class="muted">Table content is not available in this model version.</p>`;
    default: return '';
  }
}
// These kinds have a signature that is the declaration head, for example `Array i e`.
const HEAD_KEYWORDS = new Map([['data', 'data'], ['newtype', 'newtype'], ['class', 'class'], ['type_synonym', 'type'],
  ['type_family', 'type family'], ['data_family', 'data family']]);
const NAME_CHAR = /[\p{L}\p{N}_'#]/u;
// Find the first occurrence of the name as a complete token.
function nameIndex(signature, name) {
  for (let index = signature.indexOf(name); index >= 0; index = signature.indexOf(name, index + 1)) {
    if (!NAME_CHAR.test(signature[index - 1] || ' ') && !NAME_CHAR.test(signature[index + name.length] || ' ')) return index;
  }
  return -1;
}
// Keep arrows and other operators together when a long signature wraps.
const source = value => value.split(/(\S+)/).map(part => /^\S+$/.test(part) ? html`<span class="doc-token">${part}</span>` : part);
// Show a declaration as one line of Haskell source, for example `bounds :: Array i e -> (i, i)`.
function signatureLine(decl, anchor) {
  const name = text(decl.name);
  const signature = text(decl.signature);
  const keyword = HEAD_KEYWORDS.get(decl.kind);
  if (keyword) {
    const index = signature ? nameIndex(signature, name) : -1;
    const link = html`<a class="doc-name" href="#${anchor}">${name}</a>`;
    if (index < 0) return html`<span class="doc-keyword">${keyword}</span> ${link}${signature && signature !== name ? html` ${source(signature)}` : ''}`;
    return html`<span class="doc-keyword">${keyword}</span> ${source(signature.slice(0, index))}${link}${source(signature.slice(index + name.length))}`;
  }
  const shown = /^[\p{L}_]/u.test(name) ? name : `(${name})`;
  return html`<a class="doc-name" href="#${anchor}">${shown}</a>${signature ? html` <span class="doc-keyword">::</span> ${source(signature)}` : ''}`;
}
// Split a type at its top-level arrows after the context, so `Ix i => (i, i) -> [e] -> a` gives `(i, i)`, `[e]`, and `a`.
function argumentTypes(signature) {
  const type = signature.replace(/^\s*forall\b[^.]*\.\s*/, '');
  const parts = [];
  let depth = 0, start = 0;
  for (let index = 0; index < type.length; index++) {
    const char = type[index];
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (depth === 0 && (type.startsWith('->', index) || type.startsWith('=>', index))
      && !/[!#$%&*+./<=>?@\\^|~:-]/.test(type[index - 1] || ' ') && !/[!#$%&*+./<=>?@\\^|~:-]/.test(type[index + 2] || ' ')) {
      if (char === '=') parts.length = 0;
      else parts.push(type.slice(start, index).trim());
      start = index + 2;
      index++;
    }
  }
  parts.push(type.slice(start).trim());
  return parts;
}
function argumentList(decl) {
  const entries = Object.entries(decl.arg_docs || {}).sort(([a], [b]) => Number(a) - Number(b));
  if (!entries.length) return '';
  const types = argumentTypes(text(decl.signature));
  return html`<dl class="doc-arguments">${entries.map(([index, doc]) => html`<div><dt>${types[Number(index)]
    ? html`<code>${types[Number(index)]}</code>` : `Argument ${Number(index) + 1}`}</dt><dd>${docMarkup(doc?.document)}</dd></div>`)}</dl>`;
}
function declaration(decl, children = decl.subordinates) {
  const anchor = id(decl.namespace, decl.name);
  return html`<article class="doc-declaration" id="${anchor}">
    <h3 class="doc-signature"><code>${signatureLine(decl, anchor)}</code></h3>
    ${decl.warning ? html`<p class="doc-warning">${text(decl.warning)}</p>` : ''}
    <div class="prose">${docMarkup(decl.doc?.document)}</div>
    ${argumentList(decl)}
    ${array(children).map(child => declaration(child))}</article>`;
}
// A section can include text after its first line. Keep that text outside the heading.
function splitSection(doc) {
  if (doc?.tag === 'DocString') {
    const index = text(doc.string).indexOf('\n');
    if (index >= 0) return [{ ...doc, string: doc.string.slice(0, index) }, { ...doc, string: doc.string.slice(index + 1) }];
  }
  if (doc?.tag === 'DocAppend') {
    const [first, rest] = splitSection(doc.first);
    if (rest) return [first, { ...doc, first: rest }];
    const [second, tail] = splitSection(doc.second);
    return [{ ...doc, first, second }, tail];
  }
  return [doc, null];
}
// Module header fields. A generator can leave these fields in the first paragraph of the description.
const HEADER_FIELDS = new Set(['module', 'description', 'copyright', 'license', 'maintainer', 'stability', 'portability']);
function firstBlock(doc) {
  if (doc?.tag !== 'DocAppend') return [doc, null];
  const [first, rest] = firstBlock(doc.first);
  return [first, rest ? { ...doc, first: rest } : doc.second];
}
function headerFields(doc) {
  if (doc?.tag !== 'DocParagraph') return null;
  const fields = {};
  let last = null;
  for (const line of plain(doc.document).split('\n')) {
    const match = /^\s*([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    const key = match?.[1].toLowerCase();
    if (HEADER_FIELDS.has(key)) { fields[key] = match[2].trim(); last = key; }
    else if (last && line.trim()) fields[last] += ` ${line.trim()}`;
    else if (line.trim()) return null;
  }
  return last ? fields : null;
}
function moduleInfo(mod) {
  const [first, rest] = firstBlock(mod.description?.document);
  const fields = headerFields(first);
  const info = { ...fields };
  for (const [key, value] of Object.entries(mod.info || {})) if (typeof value === 'string' && value.trim()) info[key] = value.trim();
  return { info, description: fields ? rest : mod.description?.document };
}
const INFO_LABELS = [['maintainer', 'Maintainer'], ['portability', 'Portability'], ['copyright', 'Copyright'], ['license', 'License']];
function slug(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
}
function reexport(packageId, moduleName, decls, emitted) {
  const shown = array(decls).filter(decl => {
    const key = `${decl.namespace}:${decl.name}`;
    if (emitted.has(key)) return false;
    emitted.add(key);
    return true;
  });
  const label = html`<span class="doc-keyword">module</span> <code>${text(moduleName)}</code>${packageId ? html` <span class="muted">${text(packageId)}</span>` : ''}`;
  if (!shown.length) return html`<p class="doc-reexport">${label}</p>`;
  return html`<details class="doc-reexport"><summary>${label} <span class="muted">· ${shown.length} ${shown.length === 1 ? 'declaration' : 'declarations'}</span></summary>${shown.map(decl => declaration(decl))}</details>`;
}
// Instance lists open by default only when they are short.
const OPEN_INSTANCES = 8;
// Respect explicit export lists. Hidden declarations remain in the JSON model.
export function renderModule(mod, { title = 'h2' } = {}) {
  let content;
  const declarations = new Map(mod.decls.map(decl => [`${decl.namespace}:${decl.name}`, decl]));
  const emitted = new Set();
  const sections = [];
  const sectionIds = new Set();
  const exports = mod.resolved_exports ?? mod.exports;
  if (exports === null) content = mod.decls.map(decl => declaration(decl));
  else content = exports.map(item => {
    const values = array(item?.contents);
    if (item?.tag === 'section_item') {
      const [heading, body] = splitSection(values[1]);
      const base = `section-${slug(plain(heading))}`;
      let anchor = base;
      for (let count = 2; sectionIds.has(anchor); count++) anchor = `${base}-${count}`;
      sectionIds.add(anchor);
      sections.push({ anchor, level: Number(values[0]) || 1, title: plain(heading) });
      return html`<h2 id="${anchor}">${docMarkup(heading)}</h2>${body ? html`<div class="prose">${docMarkup(body)}</div>` : ''}`;
    }
    if (item?.tag === 'doc_item') return html`<div class="prose">${docMarkup(values[1])}</div>`;
    if (item?.tag === 'resolved_item') {
      const decl = item.contents;
      const key = `${decl.namespace}:${decl.name}`;
      if (emitted.has(key)) return '';
      emitted.add(key);
      return declaration(decl);
    }
    if (item?.tag === 'resolved_module_item') return reexport(values[0], values[1], values[2], emitted);
    if (item?.tag === 'module_item') return reexport('', item.contents, [], emitted);
    if (item?.tag !== 'decl_item') return '';
    const key = `${text(values[1])}:${text(values[0])}`;
    if (emitted.has(key)) return '';
    emitted.add(key);
    const decl = declarations.get(key);
    if (!decl) return html`<p><code>${text(values[0])}</code> · Declaration information is not available.</p>`;
    const selection = values[2];
    const selectedNames = new Set(array(selection?.contents));
    const children = selection?.tag === 'all_subordinates' ? decl.subordinates
      : selection?.tag === 'some_subordinates' ? decl.subordinates.filter(child => selectedNames.has(child.name)) : [];
    return declaration(decl, children);
  });
  const { info, description } = moduleInfo(mod);
  const instances = array(mod.instances);
  const contents = [...sections, ...(instances.length ? [{ anchor: 'instances', level: 1, title: 'Instances' }] : [])];
  const facts = INFO_LABELS.filter(([key]) => info[key]);
  return html`<section class="doc-module${contents.length > 1 ? ' has-toc' : ''}"><header class="doc-module-head">
    <div class="doc-title-row">${title === 'h1' ? html`<h1 class="doc-title">${mod.name}</h1>` : html`<h2>${mod.name}</h2>`}${info.stability ? html`<span class="doc-stability" title="Stability">${info.stability}</span>` : ''}</div>
    ${info.description ? html`<p class="doc-synopsis">${info.description}</p>` : ''}
    <div class="prose">${docMarkup(description)}</div>
    ${mod.warning ? html`<p class="doc-warning">${text(mod.warning)}</p>` : ''}
    ${mod.diagnostics.length ? html`<details class="doc-diagnostics"><summary>${mod.diagnostics.length} generation diagnostics</summary><ul>${mod.diagnostics.map(message => html`<li>${message}</li>`)}</ul></details>` : ''}
    </header>
    ${contents.length > 1 ? html`<nav class="doc-toc" aria-label="Contents"><h2>Contents</h2><ol>${contents.map(item => html`<li class="level-${Math.min(item.level, 3)}"><a href="#${item.anchor}">${item.title}</a></li>`)}</ol></nav>` : ''}
    <div class="doc-module-body">${content}
    ${instances.length ? html`<details class="doc-instances" id="instances"${instances.length <= OPEN_INSTANCES ? raw(' open') : ''}><summary><h2>Instances</h2> <span class="muted">${instances.length}</span></summary>
      <ul>${instances.map(item => html`<li><code><span class="doc-keyword">instance</span> ${source(text(item?.head))}</code>${item?.doc ? html`<div class="prose">${docMarkup(item.doc.document)}</div>` : ''}</li>`)}</ul></details>` : ''}
    ${facts.length ? html`<dl class="doc-info">${facts.map(([key, label]) => html`<div><dt>${label}</dt><dd>${info[key]}</dd></div>`)}</dl>` : ''}
    </div>
  </section>`;
}
export function previewHtml(model, moduleName) {
  const exposed = model.modules.filter(mod => mod.exposed);
  const selected = exposed.find(mod => mod.name === moduleName) || exposed[0];
  return render(selected ? renderModule(selected) : html`<p>This result has no exposed modules.</p>`);
}
