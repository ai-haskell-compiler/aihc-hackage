import { html, render } from '../src/html.js';

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
function declaration(decl, children = decl.subordinates) {
  return html`<article class="doc-declaration" id="${id(decl.namespace, decl.name)}">
    <h3><a href="#${id(decl.namespace, decl.name)}"><code>${decl.name}</code></a><span class="doc-kind">${text(decl.kind)}</span></h3>
    ${decl.signature ? html`<pre><code>${decl.signature}</code></pre>` : html`<p class="muted">No type signature is available.</p>`}
    ${decl.warning ? html`<p class="doc-warning">${text(decl.warning)}</p>` : ''}
    <div class="prose">${docMarkup(decl.doc?.document)}</div>
    ${Object.entries(decl.arg_docs || {}).map(([index, doc]) => html`<div class="doc-argument"><span>Argument ${index}</span>${docMarkup(doc?.document)}</div>`)}
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
// Respect explicit export lists. Hidden declarations remain in the JSON model.
export function renderModule(mod) {
  let content;
  const declarations = new Map(mod.decls.map(decl => [`${decl.namespace}:${decl.name}`, decl]));
  const emitted = new Set();
  const exports = mod.resolved_exports ?? mod.exports;
  if (exports === null) content = mod.decls.map(decl => declaration(decl));
  else content = exports.map(item => {
    const values = array(item?.contents);
    if (item?.tag === 'section_item') {
      const [title, body] = splitSection(values[1]);
      return html`<h2>${docMarkup(title)}</h2>${body ? html`<div class="prose">${docMarkup(body)}</div>` : ''}`;
    }
    if (item?.tag === 'doc_item') return html`<div class="prose">${docMarkup(values[1])}</div>`;
    if (item?.tag === 'resolved_item') {
      const decl = item.contents;
      const key = `${decl.namespace}:${decl.name}`;
      if (emitted.has(key)) return '';
      emitted.add(key);
      return declaration(decl);
    }
    if (item?.tag === 'resolved_module_item') return html`<p>Module export: <code>${text(values[1])}</code> (${text(values[0])}).</p>
      ${array(values[2]).map(decl => {
        const key = `${decl.namespace}:${decl.name}`;
        if (emitted.has(key)) return '';
        emitted.add(key);
        return declaration(decl);
      })}`;
    if (item?.tag === 'module_item') return html`<p>Module export: <code>${text(item.contents)}</code>. Resolved links are not available.</p>`;
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
  return html`<section class="doc-module"><h2>${mod.name}</h2><div class="prose">${docMarkup(mod.description?.document)}</div>
    ${mod.warning ? html`<p class="doc-warning">${text(mod.warning)}</p>` : ''}
    ${mod.diagnostics.length ? html`<details class="doc-diagnostics"><summary>${mod.diagnostics.length} generation diagnostics</summary><ul>${mod.diagnostics.map(message => html`<li>${message}</li>`)}</ul></details>` : ''}
    ${content}
    ${mod.instances.length ? html`<h3>Instances</h3>${mod.instances.map(item => html`<pre><code>${text(item?.head)}</code></pre><div class="prose">${docMarkup(item?.doc?.document)}</div>`)}` : ''}
  </section>`;
}
export function previewHtml(model, moduleName) {
  const exposed = model.modules.filter(mod => mod.exposed);
  const selected = exposed.find(mod => mod.name === moduleName) || exposed[0];
  return render(selected ? renderModule(selected) : html`<p>This result has no exposed modules.</p>`);
}
