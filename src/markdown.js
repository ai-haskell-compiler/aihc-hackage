// Render CommonMark and GitHub Markdown in package READMEs as HTML text.
// The renderer escapes all source text and does not parse HTML.
// The page shows raw HTML as text.
import { escape } from './html.js';

const INLINE = new RegExp([
  String.raw`(\x60+)([^\x60]|[^\x60][\s\S]*?[^\x60])\1(?!\x60)`, // 1, 2: `code`
  String.raw`!\[([^\]]*)\]\(\s*<?((?:[^()\s<>]|\([^()\s]*\))*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)`, // 3, 4: ![alt](url)
  String.raw`\[((?:[^\[\]\\]|\\.|\[[^\]]*\])*)\]\(\s*<?((?:[^()\s<>]|\([^()\s]*\))*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)`, // 5, 6: [label](url)
  String.raw`!?\[((?:[^\[\]\\]|\\.|\[[^\]]*\])+)\](?:\[([^\]]*)\])?`, // 7, 8: [label][ref]
  String.raw`<((?:https?:\/\/|mailto:)[^>\s]+)>`, // 9: <url>
  String.raw`((?:https?:\/\/|www\.)[^\s<>"]*[^\s<>".,;:!?)\]'*_])`, // 10: bare URL
  String.raw`\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*|(?<![\w\\])__(?!\s)([\s\S]+?)(?<!\s)__(?!\w)`, // 11, 12: strong
  String.raw`\*(?![\s*])([\s\S]+?)(?<![\s\\])\*|(?<![\w\\])_(?![\s_])([\s\S]+?)(?<![\s\\])_(?!\w)`, // 13, 14: emphasis
  String.raw`~~(?!\s)([\s\S]+?)(?<!\s)~~`, // 15: strikethrough
  String.raw`(?: {2,}|\\)\n`, // hard line break
  String.raw`\\([!-\/:-@\[-\x60{-~])`, // 16: escaped character
  String.raw`&(#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z]{2,8});`, // 17: entity
].join('|'), 'g');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←' };

function entity(name) {
  if (name[0] !== '#') return ENTITIES[name];
  const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}
function safeUrl(url) {
  if (/^www\./i.test(url)) return `https://${url}`;
  return /^(?:https?:\/\/|mailto:)/i.test(url) ? url : null;
}
const anchor = (href, content) => `<a href="${escape(href)}" rel="nofollow noopener">${content}</a>`;

function inline(text, refs, inLink = false) {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    out += escape(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [whole, , code, alt, imageUrl, label, url, refLabel, ref, angleUrl, bareUrl,
      strongStar, strongLine, emStar, emLine, strike, escaped, entityName] = match;
    if (code !== undefined) {
      const trimmed = /^ .* $/s.test(code) && code.trim() ? code.slice(1, -1) : code;
      out += `<code>${escape(trimmed.replace(/\n/g, ' '))}</code>`;
    } else if (alt !== undefined) out += image(alt, imageUrl);
    else if (label !== undefined) out += link(label, url, refs, inLink);
    else if (refLabel !== undefined) {
      const target = refs.get(normalize(ref || refLabel));
      if (target === undefined) {
        out += escape(whole[0] === '!' ? '![' : '[') + inline(refLabel, refs, inLink) + ']';
        if (ref !== undefined) out += escape(`[${ref}]`);
      } else if (whole[0] === '!') out += image(refLabel, target);
      else out += link(refLabel, target, refs, inLink);
    } else if (angleUrl !== undefined || bareUrl !== undefined) {
      const value = angleUrl ?? bareUrl;
      const href = safeUrl(value);
      if (href && !inLink) out += anchor(href, escape(value.replace(/^mailto:/i, '')));
      else out += escape(value);
    } else if (strongStar !== undefined || strongLine !== undefined) out += `<strong>${inline(strongStar ?? strongLine, refs, inLink)}</strong>`;
    else if (emStar !== undefined || emLine !== undefined) out += `<em>${inline(emStar ?? emLine, refs, inLink)}</em>`;
    else if (strike !== undefined) out += `<del>${inline(strike, refs, inLink)}</del>`;
    else if (escaped !== undefined) out += escape(escaped);
    else if (entityName !== undefined) out += escape(entity(entityName) ?? whole);
    else out += '<br>';
  }
  return out + escape(text.slice(last));
}
function link(label, url, refs, inLink) {
  const href = safeUrl(url);
  const content = inline(label, refs, true);
  if (!href || inLink) return content;
  return anchor(href, content);
}
// Show an image when its address uses HTTP or HTTPS. Show the alternative text for other images.
// The browser loads images over HTTPS only and does not send a referrer.
function image(alt, url) {
  const text = alt.replace(/[\\*_`]/g, '').trim();
  if (!/^https?:\/\//i.test(url)) return escape(text);
  const src = url.replace(/^http:/i, 'https:');
  return `<img src="${escape(src)}" alt="${escape(text)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}
const normalize = label => label.trim().replace(/\s+/g, ' ').toLowerCase();

const FENCE = /^( {0,3})(\x60{3,}|~{3,})\s*([^\s\x60]*)[^\x60]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+(.*)|[ \t]*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const HTML = /^ {0,3}<(?:\/?[A-Za-z][\w-]*(?:\s|\/?>|$)|!--)/;
const DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const expandTabs = line => line.replace(/^[ \t]+/, space => space.replace(/\t/g, '    '));
const indent = line => /^ */.exec(line)[0].length;
const blank = line => line.trim() === '';
const codeBlock = (text, language) => `<pre><code${language ? ` data-language="${escape(language)}"` : ''}>${escape(text)}</code></pre>`;

// Return true if a line can interrupt a paragraph.
function interrupts(line) {
  if (FENCE.test(line) || ATX.test(line) || RULE.test(line) || QUOTE.test(line) || HTML.test(line)) return true;
  const item = ITEM.exec(line);
  return Boolean(item && item[4] && (/^[-*+]$/.test(item[2]) || /^1[.)]$/.test(item[2])));
}
function cells(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}

// Render block lines. A tight list item renders its paragraphs without p elements.
function blocks(lines, refs, tight = false) {
  let out = '';
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (blank(line)) { index++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const [, space, marker, language] = fence;
      const body = [];
      const end = new RegExp(`^ {0,3}${marker[0] === '~' ? '~' : '\x60'}{${marker.length},}\\s*$`);
      while (++index < lines.length && !end.test(lines[index])) body.push(lines[index].replace(new RegExp(`^ {0,${space.length}}`), ''));
      index++;
      out += codeBlock(body.join('\n'), language);
      continue;
    }
    if (indent(line) >= 4) {
      const body = [];
      while (index < lines.length && (indent(lines[index]) >= 4 || blank(lines[index]))) body.push(lines[index++].slice(4));
      while (body.length && blank(body.at(-1))) body.pop();
      out += codeBlock(body.join('\n'));
      continue;
    }
    const heading = ATX.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length + 1);
      out += `<h${level}>${inline(heading[2] || '', refs)}</h${level}>`;
      index++;
      continue;
    }
    if (RULE.test(line)) { out += '<hr>'; index++; continue; }
    if (QUOTE.test(line)) {
      const body = [];
      while (index < lines.length && !blank(lines[index])) {
        const quote = QUOTE.exec(lines[index]);
        if (!quote && interrupts(lines[index])) break;
        body.push(quote ? quote[1] : lines[index]);
        index++;
      }
      out += `<blockquote>${blocks(body, refs)}</blockquote>`;
      continue;
    }
    if (HTML.test(line)) {
      const body = [];
      while (index < lines.length && !blank(lines[index])) body.push(lines[index++]);
      const text = body.join('\n');
      if (!/^\s*<!--[\s\S]*-->\s*$/.test(text)) out += codeBlock(text);
      continue;
    }
    if (ITEM.test(line)) {
      const result = list(lines, index, refs);
      out += result.html;
      index = result.index;
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1]) && lines[index + 1].includes('-')) {
      const header = cells(line);
      const aligns = cells(lines[index + 1]).map(cell => cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : cell.startsWith(':') ? 'left' : '');
      const row = (values, tag) => `<tr>${header.map((_, column) =>
        `<${tag}${aligns[column] ? ` class="align-${aligns[column]}"` : ''}>${inline(values[column] ?? '', refs)}</${tag}>`).join('')}</tr>`;
      let body = '';
      index += 2;
      while (index < lines.length && !blank(lines[index]) && !interrupts(lines[index])) body += row(cells(lines[index++]), 'td');
      out += `<div class="table-scroll"><table><thead>${row(header, 'th')}</thead>${body ? `<tbody>${body}</tbody>` : ''}</table></div>`;
      continue;
    }

    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && !blank(lines[index])) {
      const setext = SETEXT.exec(lines[index]);
      if (!setext && interrupts(lines[index])) break;
      if (setext) {
        const tag = setext[1][0] === '=' ? 'h2' : 'h3';
        out += `<${tag}>${inline(paragraph.join('\n'), refs)}</${tag}>`;
        paragraph.length = 0;
        index++;
        break;
      }
      paragraph.push(lines[index++].replace(/^\s+/, ''));
    }
    if (paragraph.length) {
      const content = inline(paragraph.join('\n').replace(/\s+$/, ''), refs);
      out += tight ? content : `<p>${content}</p>`;
    }
  }
  return out;
}

function list(lines, start, refs) {
  const first = ITEM.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const delimiter = first[2].at(-1);
  const startNumber = ordered ? parseInt(first[2], 10) : 1;
  // Return true if a line starts a new item in this list.
  const sameList = line => {
    const item = ITEM.exec(line);
    return Boolean(item && /\d/.test(item[2]) === ordered && item[2].at(-1) === delimiter && !RULE.test(line));
  };
  let index = start;
  let loose = false;
  const items = [];
  while (index < lines.length && sameList(lines[index])) {
    const item = ITEM.exec(lines[index]);
    const content = item[4] ?? '';
    const width = item[1].length + item[2].length + (content ? Math.min(item[3].length - content.length, 4) : 1);
    const body = [content];
    index++;
    let sawBlank = false;
    while (index < lines.length) {
      const line = lines[index];
      if (blank(line)) { body.push(''); sawBlank = true; index++; continue; }
      if (indent(line) >= width) { body.push(line.slice(width)); index++; sawBlank = false; continue; }
      if (sawBlank || interrupts(line) || ITEM.test(line)) break;
      body.push(line.trim());
      index++;
    }
    while (body.length && blank(body.at(-1))) body.pop();
    // A blank line between items or between blocks of one item makes the list loose.
    const next = index < lines.length && sameList(lines[index]);
    if ((sawBlank && next) || body.some(blank)) loose = true;
    items.push(body);
    if (sawBlank && !next) break;
  }
  let html = '';
  for (const body of items) {
    const task = /^\[([ xX])\][ \t]+/.exec(body[0]);
    let prefix = '';
    if (task) {
      body[0] = body[0].slice(task[0].length);
      prefix = `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> `;
    }
    html += `<li${task ? ' class="task"' : ''}>${prefix}${blocks(body, refs, !loose)}</li>`;
  }
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}${ordered && startNumber !== 1 ? ` start="${startNumber}"` : ''}>${html}</${tag}>`, index };
}

export function markdown(source) {
  const refs = new Map();
  const lines = [];
  let fenced = null;
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = expandTabs(raw);
    const fence = FENCE.exec(line);
    if (fenced) { if (new RegExp(`^ {0,3}${fenced[0] === '~' ? '~' : '\x60'}{${fenced.length},}\\s*$`).test(line)) fenced = null; }
    else if (fence) fenced = fence[2];
    else {
      const definition = DEFINITION.exec(line);
      if (definition) {
        const key = normalize(definition[1]);
        if (!refs.has(key)) refs.set(key, definition[2]);
        continue;
      }
    }
    lines.push(line);
  }
  return blocks(lines, refs);
}
