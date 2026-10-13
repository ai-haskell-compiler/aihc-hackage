import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdown } from '../src/markdown.js';
import { haddock } from '../src/haddock.js';

const link = (href, text) => `<a href="${href}" rel="nofollow noopener">${text}</a>`;
const flat = html => html.replace(/\n/g, '');

test('The Markdown renderer removes unsafe HTML and keeps the HTML that GitHub allows.', () => {
  assert.equal(markdown('<script>alert(1)</script>\n\nText'), '\n<p>Text</p>');
  assert.equal(markdown('<a href="javascript:alert(1)">x</a> <iframe src="https://e.com"></iframe>'), '<p>x </p>');
  assert.equal(markdown('<img src="http://e.com/a.png" width="10" onerror="alert(1)">'),
    '<img src="https://e.com/a.png" width="10" loading="lazy" decoding="async" referrerpolicy="no-referrer">');
  assert.equal(markdown('<p align="center">Text</p>'), '<p align="center">Text</p>');
  assert.equal(flat(markdown('<details><summary>More</summary>\n\n**Hidden**\n</details>')),
    '<details><summary>More</summary><p><strong>Hidden</strong></p></details>');
  assert.equal(markdown('<div id="search" style="color:red">x</div>'), '<div id="user-content-search">x</div>');
  assert.equal(markdown('Text with <b>tags</b> & "quotes".'), '<p>Text with <b>tags</b> &#x26; "quotes".</p>');
});
test('The Markdown renderer hides HTML comments.', () => {
  assert.equal(flat(markdown('<!-- Generated. Do not edit. -->\n# Title\nText')), '<h2 id="user-content-title">Title</h2><p>Text</p>');
  assert.equal(markdown('a <!-- note --> b `<!-- code -->`'), '<p>a  b <code>&#x3C;!-- code --></code></p>');
});
test('The Markdown renderer removes relative links and images.', () => {
  assert.equal(markdown('[x](docs/a.md) and ![y](/local.png) and [z](javascript:alert(1))'), '<p>x and y and z</p>');
  assert.equal(markdown('[a](https://e.com) <mailto:me@e.com>'), `<p>${link('https://e.com', 'a')} ${link('mailto:me@e.com', 'mailto:me@e.com')}</p>`);
});
test('The Markdown renderer supports GitHub Flavored Markdown.', () => {
  assert.equal(flat(markdown('# Title\n\n## Title\n\n[top](#title)')),
    '<h2 id="user-content-title">Title</h2><h3 id="user-content-title-1">Title</h3><p><a href="#user-content-title">top</a></p>');
  assert.equal(flat(markdown('- [ ] open\n- [x] done')),
    '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled> open</li><li class="task-list-item"><input type="checkbox" checked disabled> done</li></ul>');
  assert.equal(markdown('| a | b |\n|:-:|--:|\n| 1 | 2 |'),
    '<div class="table-scroll"><table><thead><tr><th align="center">a</th><th align="right">b</th></tr></thead><tbody><tr><td align="center">1</td><td align="right">2</td></tr></tbody></table></div>');
  assert.equal(markdown('~~gone~~ www.example.com'), `<p><del>gone</del> ${link('http://www.example.com', 'www.example.com')}</p>`);
  assert.equal(markdown('```haskell\nmain = <go>\n```'), '<pre><code class="language-haskell">main = &#x3C;go>\n</code></pre>');
  const notes = markdown('Note[^1]\n\n[^1]: Text.');
  assert.match(notes, /<a href="#user-content-fn-1" id="user-content-fnref-1"/);
  assert.match(notes, /<li id="user-content-fn-1">/);
  assert.match(notes, /<a href="#user-content-fnref-1"/);
});
test('The Haddock renderer escapes source text and links modules.', () => {
  assert.equal(haddock('Use "Data.Text" with @f <x>@.\n.\n= Heading\n\n* one\n* two\n\n> code <y>', module => `/search?q=${module}`),
    '<p>Use <a href="/search?q=Data.Text"><code>Data.Text</code></a> with <code>f &lt;x&gt;</code>.</p><h3>Heading</h3><ul><li>one</li><li>two</li></ul><pre><code>code &lt;y&gt;</code></pre>');
  assert.equal(haddock('See <https://example.com docs> or [site](ftp://x).'),
    '<p>See <a href="https://example.com" rel="nofollow noopener">docs</a> or site.</p>');
});
