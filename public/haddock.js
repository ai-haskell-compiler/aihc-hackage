// Render the Haddock markup subset that Cabal descriptions use.
// The renderer creates DOM nodes and does not parse HTML.
// A line that contains only "." separates paragraphs, as in Haddock.

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

function anchor(text, href) {
  const node = document.createElement('a');
  node.textContent = text;
  node.href = href;
  node.rel = 'nofollow noopener';
  return node;
}
function inline(text, moduleHref) {
  const fragment = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    fragment.append(text.slice(last, match.index));
    last = match.index + match[0].length;
    const [whole, label, url, angleUrl, angleLabel, bareUrl, code, module, identifier, bold, emphasis, escaped] = match;
    if (label !== undefined) {
      const href = safeUrl(url);
      fragment.append(href ? anchor(label, href) : label);
    } else if (angleUrl !== undefined) fragment.append(anchor(angleLabel || angleUrl, angleUrl));
    else if (bareUrl !== undefined) fragment.append(anchor(bareUrl, bareUrl));
    else if (code !== undefined) { const node = document.createElement('code'); node.append(inline(code, moduleHref)); fragment.append(node); }
    else if (module !== undefined) {
      const node = document.createElement('a');
      node.href = moduleHref(module);
      const code = document.createElement('code'); code.textContent = module; node.append(code);
      fragment.append(node);
    } else if (identifier !== undefined) { const node = document.createElement('code'); node.textContent = identifier; fragment.append(node); }
    else if (bold !== undefined) { const node = document.createElement('strong'); node.append(inline(bold, moduleHref)); fragment.append(node); }
    else if (emphasis !== undefined) { const node = document.createElement('em'); node.append(inline(emphasis, moduleHref)); fragment.append(node); }
    else if (escaped !== undefined) fragment.append(escaped);
    else fragment.append(whole);
  }
  fragment.append(text.slice(last));
  return fragment;
}

const LIST_ITEM = /^\s*(?:([*-])|\((\d+)\)|(\d+)\.)\s+(.*)$/;
const HEADING = /^(={1,6})\s+(.*)$/;

export function haddock(source, moduleHref = () => '#') {
  const fragment = document.createDocumentFragment();
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let paragraph = null;
  let list = null;
  let code = null;
  const close = () => {
    if (paragraph) {
      const node = document.createElement('p');
      node.append(inline(paragraph.join(' '), moduleHref));
      fragment.append(node);
    }
    if (list) {
      const node = document.createElement(list.ordered ? 'ol' : 'ul');
      for (const item of list.items) {
        const li = document.createElement('li');
        li.append(inline(item.join(' '), moduleHref));
        node.append(li);
      }
      fragment.append(node);
    }
    if (code) {
      const pre = document.createElement('pre');
      const node = document.createElement('code');
      node.textContent = code.join('\n');
      pre.append(node);
      fragment.append(pre);
    }
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
      const node = document.createElement(`h${Math.min(6, heading[1].length + 2)}`);
      node.append(inline(heading[2], moduleHref));
      fragment.append(node);
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
  return fragment;
}
