import test from 'node:test';
import assert from 'node:assert/strict';
import { renderModule } from '../documentation/render.js';
import { documentationPage } from '../src/documentation-pages.js';
import { render } from '../src/html.js';

const decl = (kind, name, signature, extra = {}) => ({ kind, name, signature, namespace: kind === 'class' || kind === 'data' || kind === 'newtype' || kind === 'type_synonym' ? 'type' : 'value',
  doc: null, warning: null, arg_docs: {}, subordinates: [], ...extra });
const text = value => value.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
const module = (name, decls) => ({ name, exposed: true, decls, exports: null, description: null, warning: null, diagnostics: [], instances: [] });

test('Declarations show one line of Haskell source.', () => {
  const html = render(renderModule(module('M', [
    decl('function', 'bounds', 'Array i e -> (i, i)'),
    decl('function', '!', 'Ix i => Array i e -> i -> e'),
    decl('class', 'MArray', '(Monad m) => MArray a e m', { subordinates: [decl('method', 'getBounds', 'Ix i => a i e -> m (i, i)')] }),
    decl('newtype', 'IOArray', 'IOArray i e', { subordinates: [decl('constructor', 'IOArray', 'STArray RealWorld i e -> IOArray i e')] }),
    decl('type_synonym', 'ListUArray', 'ListUArray e = forall i. Ix i => (i, i) -> [e] -> UArray i e'),
    decl('function', 'noSignature', null),
  ])));
  const lines = [...html.matchAll(/<h3 class="doc-signature"><code>(.*?)<\/code><\/h3>/gs)].map(match => text(match[1]));
  assert.deepEqual(lines, [
    'bounds :: Array i e -> (i, i)',
    '(!) :: Ix i => Array i e -> i -> e',
    'class (Monad m) => MArray a e m',
    'getBounds :: Ix i => a i e -> m (i, i)',
    'newtype IOArray i e',
    'IOArray :: STArray RealWorld i e -> IOArray i e',
    'type ListUArray e = forall i. Ix i => (i, i) -> [e] -> UArray i e',
    'noSignature',
  ]);
  assert.match(html, /class<\/span> <span class="doc-token">\(Monad<\/span> <span class="doc-token">m\)<\/span> <span class="doc-token">=&gt;<\/span> <a class="doc-name" href="#decl-type-MArray">MArray<\/a>/);
  assert.doesNotMatch(html, /native code/);
});

test('The documentation page shows a compact header and a module tree.', () => {
  const names = ['Data.Array', 'Data.Array.Base', 'Data.Array.IO', 'Data.Array.IO.Safe', 'Other.Deep.Module'];
  const result = { id: 'a'.repeat(64), plan_id: 'b'.repeat(64), name: 'array', version: '0.5.8.0', provenance: 'community', diagnostics: 0,
    model: { modules: names.map(name => module(name, [])) },
    plan: { generator: 'g', metadataSha256: 'c'.repeat(64), packages: [] } };
  const html = documentationPage(result, 'Data.Array.IO.Safe');
  assert.match(html, /<nav class="doc-crumbs"[^>]*><a href="\/package\/array\/0\.5\.8\.0\/api">array<\/a>/);
  assert.match(html, /<h1 class="doc-title">Data\.Array\.IO\.Safe<\/h1>/);
  assert.match(html, />Community<\/a>/);
  assert.match(html, /<summary><a href="[^"]*\/Data\.Array"[^>]*>Data\.Array<\/a><\/summary>/);
  assert.match(html, /<li><a href="[^"]*\/Other\.Deep\.Module" title="Other\.Deep\.Module">Other\.Deep\.Module<\/a><\/li>/);
  assert.match(html, /<a href="[^"]*\/Data\.Array\.IO\.Safe" title="Data\.Array\.IO\.Safe" aria-current="page">\.Safe<\/a>/);
  assert.doesNotMatch(documentationPage({ ...result, model: { modules: [module('Only', [])] } }), /class="doc-nav"/);
});

test('Module header fields leave the description and show beside the module.', () => {
  const para = string => ({ tag: 'DocParagraph', document: { tag: 'DocString', string } });
  const mod = { ...module('Data.Array', []), info: { copyright: '(c) Glasgow', license: 'BSD', maintainer: null, stability: null, portability: null, description: null },
    description: { document: { tag: 'DocAppend', first: para('Maintainer  :  libraries@haskell.org\n Stability   :  experimental\n Portability :  non-portable (MPTCs, uses\n Control.Monad.ST)'),
      second: para('Basic non-strict arrays.') } } };
  const html = render(renderModule(mod));
  assert.match(html, /<span class="doc-stability" title="Stability">experimental<\/span>/);
  assert.match(html, /<div class="prose"><p>Basic non-strict arrays\.<\/p><\/div>/);
  assert.doesNotMatch(html, /Maintainer  :/);
  assert.match(html, /<dt>Maintainer<\/dt><dd>libraries@haskell\.org<\/dd>/);
  assert.match(html, /<dt>Portability<\/dt><dd>non-portable \(MPTCs, uses Control\.Monad\.ST\)<\/dd>/);
  assert.match(html, /<dt>License<\/dt><dd>BSD<\/dd>/);
  const ordinary = { ...module('M', []), description: { document: para('Note: this is text.') } };
  assert.match(render(renderModule(ordinary)), /Note: this is text\./);
});

test('Modules list sections, collapse long instance lists and re-exports, and label arguments by type.', () => {
  const section = title => ({ tag: 'section_item', contents: [1, { tag: 'DocString', string: title }] });
  const mod = { ...module('M', []), exports: null,
    resolved_exports: [section('Construction'), section('Construction'),
      { tag: 'resolved_module_item', contents: ['base-4', 'Data.Ix', [decl('class', 'Ix', 'Ix a')]] },
      { tag: 'resolved_item', contents: decl('function', 'array', 'forall i e. Ix i => (i, i) -> [(i, e)] -> Array i e',
        { arg_docs: { 0: { document: { tag: 'DocString', string: 'bounds' } }, 1: { document: { tag: 'DocString', string: 'pairs' } }, 5: { document: { tag: 'DocString', string: 'other' } } } }) }],
    instances: Array.from({ length: 9 }, (_, index) => ({ head: `C T${index}`, doc: null })) };
  const html = render(renderModule(mod));
  assert.match(html, /<nav class="doc-toc" aria-label="Contents">.*href="#section-construction">.*href="#section-construction-2">.*href="#instances">Instances/s);
  assert.match(html, /<details class="doc-reexport"><summary><span class="doc-keyword">module<\/span> <code>Data\.Ix<\/code> <span class="muted">base-4<\/span> <span class="muted">· 1 declaration<\/span><\/summary>/);
  assert.match(html, /<details class="doc-instances" id="instances"><summary>/);
  assert.match(html, /<dt><code>\(i, i\)<\/code><\/dt><dd>bounds<\/dd>.*<dt><code>\[\(i, e\)\]<\/code><\/dt><dd>pairs<\/dd>.*<dt>Argument 6<\/dt>/s);
  assert.match(render(renderModule({ ...mod, instances: mod.instances.slice(0, 2) })), /<details class="doc-instances" id="instances" open>/);
});
