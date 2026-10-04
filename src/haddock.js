// Render the Haddock markup subset that Cabal descriptions use as HTML text.
// The renderer escapes all source text and does not parse HTML.
// A line that contains only "." separates paragraphs, as in Haddock.
import { escape } from './html.js';

const INLINE = new RegExp([
  String.raw`\[([^\]\n]+)\]\(([^)\s]+)\)`, // 1, 2: [label](url)
  String.raw`<(https?://[^>\s]+)(?:\s+([^>]+))?>`, // 3, 4: <url label>
  String.raw`(https?://[^\s<>"]+[^\s<>".,;:!?)\]'])`, // 5: bare URL
  String.raw`@([^@\n]+)@`, // 6: @code@
  String.raw`"([A-Z][\w']*(?:\.[A-Z][\w']*)*)"`, // 7: "Module.Name"
  String.raw`(?<![\w'])'([A-Za-z_][\w.']*?|[!#$%&*+./<=>?\\^|~:-]+)'(?!\w)`, // 8: 'identifier'
  String.raw`__([^_\n]+)__`, // 9: __bold__
  String.raw`(?<![\w/:])/([^/\s](?:[^/\n]*[^/\s])?)/(?![\w/])`, // 10: /emphasis/
  String.raw`\\(.)`, // 11: escaped character
].join('|'), 'g');

const safeUrl = url => /^https?:\/\//i.test(url) ? url : null;
const anchor = (text, href) => `<a href="${escape(href)}" rel="nofollow noopener">${escape(text)}</a>`;

function inline(text, moduleHref) {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    out += escape(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [whole, label, url, angleUrl, angleLabel, bareUrl, code, module, identifier, bold, emphasis, escaped] = match;
    if (label !== undefined) {
      const href = safeUrl(url);
      out += href ? anchor(label, href) : escape(label);
    } else if (angleUrl !== undefined) out += anchor(angleLabel || angleUrl, angleUrl);
    else if (bareUrl !== undefined) out += anchor(bareUrl, bareUrl);
    else if (code !== undefined) out += `<code>${inline(code, moduleHref)}</code>`;
    else if (module !== undefined) out += `<a href="${escape(moduleHref(module))}"><code>${escape(module)}</code></a>`;
    else if (identifier !== undefined) out += `<code>${escape(identifier)}</code>`;
    else if (bold !== undefined) out += `<strong>${inline(bold, moduleHref)}</strong>`;
    else if (emphasis !== undefined) out += `<em>${inline(emphasis, moduleHref)}</em>`;
    else if (escaped !== undefined) out += escape(escaped);
    else out += escape(whole);
  }
  return out + escape(text.slice(last));
}

const LIST_ITEM = /^\s*(?:([*-])|\((\d+)\)|(\d+)\.)\s+(.*)$/;
const HEADING = /^(={1,6})\s+(.*)$/;

export function haddock(source, moduleHref = () => '#') {
  let out = '';
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let paragraph = null;
  let list = null;
  let code = null;
  const close = () => {
    if (paragraph) out += `<p>${inline(paragraph.join(' '), moduleHref)}</p>`;
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul';
      out += `<${tag}>${list.items.map(item => `<li>${inline(item.join(' '), moduleHref)}</li>`).join('')}</${tag}>`;
    }
    if (code) out += `<pre><code>${escape(code.join('\n'))}</code></pre>`;
    paragraph = list = code = null;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed === '.') { close(); continue; }
    if (trimmed === '@' && !paragraph && !list && !code) {
      const block = [];
      while (++index < lines.length && lines[index].trim() !== '@') block.push(lines[index].trim() === '.' ? '' : lines[index]);
      code = block;
      close();
      continue;
    }
    if (/^>/.test(trimmed)) {
      if (!code) { close(); code = []; }
      code.push(trimmed.startsWith('>>>') ? trimmed : trimmed.replace(/^> ?/, ''));
      continue;
    }
    if (code) close();
    const heading = HEADING.exec(trimmed);
    if (heading && !paragraph && !list) {
      const level = Math.min(6, heading[1].length + 2);
      out += `<h${level}>${inline(heading[2], moduleHref)}</h${level}>`;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item && !paragraph) {
      const ordered = item[1] === undefined;
      if (list && list.ordered !== ordered) close();
      list ||= { ordered, items: [] };
      list.items.push([item[4]]);
      continue;
    }
    if (list) { list.items.at(-1).push(trimmed); continue; }
    paragraph ||= [];
    paragraph.push(trimmed);
  }
  close();
  return out;
}
