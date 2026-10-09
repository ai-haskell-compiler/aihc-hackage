import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { GENERATOR, TARGET, digest, encode } from '../../documentation/contract.js';

export function tar(entries, { type = 48 } = {}) {
  const parts = [];
  for (const [path, content] of entries) {
    const bytes = typeof content === 'string' ? encode(content) : content;
    const header = new Uint8Array(512);
    const put = (value, offset) => header.set(encode(value), offset);
    put(path, 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116);
    put(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124); put('00000000000\0', 136);
    put('        ', 148); header[156] = type; put('ustar\0', 257); put('00', 263);
    put(`${header.reduce((n, value) => n + value, 0).toString(8).padStart(6, '0')}\0 `, 148);
    parts.push(header, bytes, new Uint8Array((512 - bytes.length % 512) % 512));
  }
  return Buffer.concat([...parts, new Uint8Array(1024)]);
}
export async function fixturePlan() {
  const files = new Map();
  const original = await readFile('test/fixtures/docs-sample/docs-sample.cabal', 'utf8');
  const cabal = original.replace('library', 'flag extra\n  default: False\n\nlibrary')
    + '\n  if flag(extra)\n    exposed-modules: Docs.Extra\n  if os(linux)\n    exposed-modules: Docs.Linux\n';
  const source = await readFile('test/fixtures/docs-sample/src/Docs/Sample.hs');
  const archive = gzipSync(tar([
    ['docs-sample-0.1.0.0/docs-sample.cabal', original], ['docs-sample-0.1.0.0/src/Docs/Sample.hs', source],
    ['docs-sample-0.1.0.0/src/Docs/Extra.hs', 'module Docs.Extra where\nextra :: Bool\nextra = True\n'],
    ['docs-sample-0.1.0.0/src/Docs/Linux.hs', 'module Docs.Linux where\nlinux :: Bool\nlinux = True\n'],
  ]));
  const cabalSha256 = await digest(encode(cabal)); const archiveSha256 = await digest(archive);
  files.set(cabalSha256, encode(cabal)); files.set(archiveSha256, archive);
  const plan = { format: 1, generator: GENERATOR, target: TARGET, metadataSha256: 'a'.repeat(64), resolvedAt: 1790899200,
    root: { name: 'docs-sample', version: '0.1.0.0', cabalSha256 }, packages: [{ name: 'docs-sample', version: '0.1.0.0',
      source: 'hackage', revision: 1, cabalSha256, archiveSha256, archiveSize: archive.length, flags: { extra: true }, dependencies: [] }] };
  return { plan, files, cabal };
}
export function fixtureModel(plan) {
  return { format_version: 1, name: plan.root.name, version: plan.root.version, dependencies: [], modules: [{ name: 'Docs.Sample', exposed: true,
    description: { document: { tag: 'DocString', string: '<script>unsafe()</script>' } }, diagnostics: ['A type signature is missing.'], instances: [],
    exports: [{ tag: 'decl_item', contents: ['greet', 'value', { tag: 'no_subordinates' }] }],
    decls: [{ name: 'greet', namespace: 'value', kind: 'function', signature: 'String -> String', subordinates: [],
      doc: { document: { tag: 'DocHyperlink', hyperlink: { hyperlinkUrl: 'javascript:alert(1)', hyperlinkLabel: { tag: 'DocString', string: 'Unsafe link' } } } } },
    { name: 'privateValue', namespace: 'value', kind: 'function', signature: 'Bool', subordinates: [] }],
  }] };
}
