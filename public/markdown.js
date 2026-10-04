// Render CommonMark and GitHub Markdown in package READMEs.
// The renderer creates DOM nodes and does not parse HTML.
// The page shows raw HTML as text.

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

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←' };

function entity(name) {
  if (name[0] !== '#') return ENTITIES[name];
  const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : undefined;
}
function safeUrl(url) {
  if (/^www\./i.test(url)) return `https://${url}`;
  return /^(?:https?:\/\/|mailto:)/i.test(url) ? url : null;
}
function anchor(href) {
  const node = document.createElement('a');
  node.href = href;
  node.rel = 'nofollow noopener';
  return node;
}
function create(tag, children) {
  const node = document.createElement(tag);
  node.append(children);
  return node;
}

function inline(text, refs, inLink = false) {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    fragment.append(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [whole, , code, alt, imageUrl, label, url, refLabel, ref, angleUrl, bareUrl,
      strongStar, strongLine, emStar, emLine, strike, escaped, entityName] = match;
    if (code !== undefined) {
      const trimmed = /^ .* $/s.test(code) && code.trim() ? code.slice(1, -1) : code;
      fragment.append(create('code', trimmed.replace(/\n/g, ' ')));
    } else if (alt !== undefined) fragment.append(image(alt, imageUrl));
    else if (label !== undefined) fragment.append(link(label, url, refs, inLink));
    else if (refLabel !== undefined) {
      const target = refs.get(normalize(ref || refLabel));
      if (target === undefined) { fragment.append(whole[0] === '!' ? '![' : '[', inline(refLabel, refs, inLink), ']'); if (ref !== undefined) fragment.append(`[${ref}]`); }
      else if (whole[0] === '!') fragment.append(image(refLabel, target));
      else fragment.append(link(refLabel, target, refs, inLink));
    } else if (angleUrl !== undefined || bareUrl !== undefined) {
      const value = angleUrl ?? bareUrl;
      const href = safeUrl(value);
      if (href && !inLink) { const node = anchor(href); node.textContent = value.replace(/^mailto:/i, ''); fragment.append(node); }
      else fragment.append(value);
    } else if (strongStar !== undefined || strongLine !== undefined) fragment.append(create('strong', inline(strongStar ?? strongLine, refs, inLink)));
    else if (emStar !== undefined || emLine !== undefined) fragment.append(create('em', inline(emStar ?? emLine, refs, inLink)));
    else if (strike !== undefined) fragment.append(create('del', inline(strike, refs, inLink)));
    else if (escaped !== undefined) fragment.append(escaped);
    else if (entityName !== undefined) fragment.append(entity(entityName) ?? whole);
    else fragment.append(document.createElement('br'));
  }
  fragment.append(text.slice(last));
  return fragment;
}
function link(label, url, refs, inLink) {
  const href = safeUrl(url);
  const content = inline(label, refs, true);
  if (!href || inLink) return content;
  const node = anchor(href);
  node.append(content);
  return node;
}
// Show an image as a link to the image, with the alternative text as the label.
// Load images over HTTPS only. Show the alternative text for other images.
function image(alt, url) {
  const text = alt.replace(/[\\*_`]/g, '').trim();
  if (!/^https?:\/\//i.test(url)) return text;
  const node = document.createElement('img');
  node.src = url.replace(/^http:/i, 'https:');
  node.alt = text;
  node.loading = 'lazy';
  node.decoding = 'async';
  node.referrerPolicy = 'no-referrer';
  return node;
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

function blocks(lines, refs) {
  const fragment = document.createDocumentFragment();
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
      const code = create('code', body.join('\n'));
      if (language) code.dataset.language = language;
      fragment.append(create('pre', code));
      continue;
    }
    if (indent(line) >= 4) {
      const body = [];
      while (index < lines.length && (indent(lines[index]) >= 4 || blank(lines[index]))) body.push(lines[index++].slice(4));
      while (body.length && blank(body.at(-1))) body.pop();
      fragment.append(create('pre', create('code', body.join('\n'))));
      continue;
    }
    const heading = ATX.exec(line);
    if (heading) {
      fragment.append(create(`h${Math.min(6, heading[1].length + 1)}`, inline(heading[2] || '', refs)));
      index++;
      continue;
    }
    if (RULE.test(line)) { fragment.append(document.createElement('hr')); index++; continue; }
    if (QUOTE.test(line)) {
      const body = [];
      while (index < lines.length && !blank(lines[index])) {
        const quote = QUOTE.exec(lines[index]);
        if (!quote && interrupts(lines[index])) break;
        body.push(quote ? quote[1] : lines[index]);
        index++;
      }
      fragment.append(create('blockquote', blocks(body, refs)));
      continue;
    }
    if (HTML.test(line)) {
      const body = [];
      while (index < lines.length && !blank(lines[index])) body.push(lines[index++]);
      const text = body.join('\n');
      if (!/^\s*<!--[\s\S]*-->\s*$/.test(text)) fragment.append(create('pre', create('code', text)));
      continue;
    }
    const item = ITEM.exec(line);
    if (item) { index = list(lines, index, refs, fragment); continue; }
    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1]) && lines[index + 1].includes('-')) {
      const header = cells(line);
      const aligns = cells(lines[index + 1]).map(cell => cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : cell.startsWith(':') ? 'left' : '');
      const table = document.createElement('table');
      const row = (values, tag) => {
        const tr = document.createElement('tr');
        header.forEach((_, column) => {
          const cell = create(tag, inline(values[column] ?? '', refs));
          if (aligns[column]) cell.style.textAlign = aligns[column];
          tr.append(cell);
        });
        return tr;
      };
      table.append(create('thead', row(header, 'th')));
      const body = document.createElement('tbody');
      index += 2;
      while (index < lines.length && !blank(lines[index]) && !interrupts(lines[index])) body.append(row(cells(lines[index++]), 'td'));
      if (body.childElementCount) table.append(body);
      fragment.append(create('div', table));
      fragment.lastChild.className = 'table-scroll';
      continue;
    }

    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && !blank(lines[index])) {
      const setext = SETEXT.exec(lines[index]);
      if (!setext && interrupts(lines[index])) break;
      if (setext) {
        fragment.append(create(setext[1][0] === '=' ? 'h2' : 'h3', inline(paragraph.join('\n'), refs)));
        paragraph.length = 0;
        index++;
        break;
      }
      paragraph.push(lines[index++].replace(/^\s+/, ''));
    }
    if (paragraph.length) fragment.append(create('p', inline(paragraph.join('\n').replace(/\s+$/, ''), refs)));
  }
  return fragment;
}

function list(lines, start, refs, fragment) {
  const first = ITEM.exec(lines[start]);
  const ordered = /\d/.test(first[2]);
  const delimiter = first[2].at(-1);
  const node = document.createElement(ordered ? 'ol' : 'ul');
  if (ordered && parseInt(first[2], 10) !== 1) node.start = parseInt(first[2], 10);
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
  for (const body of items) {
    const li = document.createElement('li');
    const task = /^\[([ xX])\][ \t]+/.exec(body[0]);
    if (task) {
      body[0] = body[0].slice(task[0].length);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.disabled = true;
      box.checked = task[1] !== ' ';
      li.className = 'task';
      li.append(box, ' ');
    }
    const content = blocks(body, refs);
    if (!loose) for (const child of [...content.childNodes]) if (child.nodeName === 'P') child.replaceWith(...child.childNodes);
    li.append(content);
    node.append(li);
  }
  fragment.append(node);
  return index;
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
