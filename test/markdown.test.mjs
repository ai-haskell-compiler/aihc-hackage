import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdown } from '../src/markdown.js';
import { haddock } from '../src/haddock.js';

test('The Markdown renderer escapes source text and does not parse HTML.', () => {
  assert.equal(markdown('Text with <b>tags</b> & "quotes".'), '<p>Text with &lt;b&gt;tags&lt;/b&gt; &amp; &quot;quotes&quot;.</p>');
  assert.equal(markdown('<div>\nblock\n</div>'), '<pre><code>&lt;div&gt;\nblock\n&lt;/div&gt;</code></pre>');
  assert.equal(markdown('<!-- note -->'), '');
  assert.equal(markdown('[x](javascript:alert(1)) and ![y](/local.png)'), '<p>x and y</p>');
});
test('The Markdown renderer supports headings, lists, tables, and links.', () => {
  assert.equal(markdown('# Title\n\nText\n====\n\nSub\n---'), '<h2>Title</h2><h2>Text</h2><h3>Sub</h3>');
  assert.equal(markdown('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(markdown('3. a\n\n4. b'), '<ol start="3"><li><p>a</p></li><li><p>b</p></li></ol>');
  assert.equal(markdown('- [ ] open\n- [x] done'), '<ul><li class="task"><input type="checkbox" disabled> open</li><li class="task"><input type="checkbox" disabled checked> done</li></ul>');
  assert.equal(markdown('| a | b |\n|:-:|--:|\n| 1 | 2 |'),
    '<div class="table-scroll"><table><thead><tr><th class="align-center">a</th><th class="align-right">b</th></tr></thead><tbody><tr><td class="align-center">1</td><td class="align-right">2</td></tr></tbody></table></div>');
  assert.equal(markdown('[ref] and [other][ref]\n\n[ref]: https://example.com'),
    '<p><a href="https://example.com" rel="nofollow noopener">ref</a> and <a href="https://example.com" rel="nofollow noopener">other</a></p>');
  assert.equal(markdown('![alt](http://example.com/a.png "title")'),
    '<p><img src="https://example.com/a.png" alt="alt" loading="lazy" decoding="async" referrerpolicy="no-referrer"></p>');
  assert.equal(markdown('> quote\n> more\n\n```haskell\nmain = <go>\n```'),
    '<blockquote><p>quote\nmore</p></blockquote><pre><code data-language="haskell">main = &lt;go&gt;</code></pre>');
  assert.equal(markdown('`code` **bold** _em_ ~~gone~~ &amp; &copy; line\\\nbreak'),
    '<p><code>code</code> <strong>bold</strong> <em>em</em> <del>gone</del> &amp; © line<br>break</p>');
});
test('The Haddock renderer escapes source text and links modules.', () => {
  assert.equal(haddock('Use "Data.Text" with @f <x>@.\n.\n= Heading\n\n* one\n* two\n\n> code <y>', module => `/search?q=${module}`),
    '<p>Use <a href="/search?q=Data.Text"><code>Data.Text</code></a> with <code>f &lt;x&gt;</code>.</p><h3>Heading</h3><ul><li>one</li><li>two</li></ul><pre><code>code &lt;y&gt;</code></pre>');
  assert.equal(haddock('See <https://example.com docs> or [site](ftp://x).'),
    '<p>See <a href="https://example.com" rel="nofollow noopener">docs</a> or site.</p>');
});
