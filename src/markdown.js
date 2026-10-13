// Render GitHub Flavored Markdown in package READMEs as safe HTML text.
// The pipeline parses raw HTML and then removes all elements, attributes, and URLs
// that the GitHub sanitization schema does not allow.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

// The sanitizer adds this prefix to each id and name attribute to prevent DOM clobbering.
const PREFIX = defaultSchema.clobberPrefix;

// Apply a function to each element in a hast tree. The function can replace the children of an element.
function walk(node, visit) {
  if (!node.children) return;
  node.children = node.children.flatMap(child => {
    if (child.type !== 'element') return [child];
    walk(child, visit);
    return visit(child) ?? [child];
  });
}
const text = node => node.type === 'text' ? node.value : (node.children ?? []).map(text).join('');

// Make a heading anchor in the GitHub format: lowercase, without punctuation, with hyphens for spaces.
function slugger() {
  const seen = new Map();
  return value => {
    const base = value.toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

// Remove whitespace text in tables before the HTML parser moves it in front of the table.
function tableWhitespace() {
  const tags = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr']);
  return tree => walk(tree, node => {
    if (tags.has(node.tagName)) node.children = node.children.filter(child => child.type !== 'text' || child.value.trim());
  });
}

// Change sanitized HTML for this site:
// - Move headings down one level, because the page title is the h1 element.
// - Give headings anchors and point fragment links to the prefixed anchors.
// - Remove relative links and images, because the site does not have the other files of the package.
// - Load images over HTTPS without a referrer, and do not pass ranking to external links.
// - Put each table in a box that scrolls on small screens.
function site() {
  return tree => {
    const slug = slugger();
    walk(tree, node => {
      const { tagName: tag, properties: props } = node;
      if (/^h[1-6]$/.test(tag)) {
        node.tagName = `h${Math.min(6, Number(tag[1]) + 1)}`;
        if (!props.id) props.id = PREFIX + slug(text(node));
      } else if (tag === 'a' && typeof props.href === 'string') {
        const href = props.href;
        if (href.startsWith('#')) {
          if (!href.startsWith(`#${PREFIX}`)) props.href = `#${PREFIX}${href.slice(1)}`;
        } else if (/^(?:https?:|mailto:)/i.test(href)) props.rel = ['nofollow', 'noopener'];
        else return node.children;
      } else if (tag === 'a') return node.children;
      else if (tag === 'img') {
        const src = typeof props.src === 'string' ? props.src : '';
        if (!/^https?:\/\//i.test(src)) return props.alt ? [{ type: 'text', value: String(props.alt) }] : [];
        Object.assign(props, { src: src.replace(/^http:/i, 'https:'), loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer' });
      } else if (tag === 'table') {
        return [{ type: 'element', tagName: 'div', properties: { className: ['table-scroll'] }, children: [node] }];
      }
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  // The sanitizer adds the prefix to footnote anchors, so remark-rehype must not also add it.
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
  .use(tableWhitespace)
  .use(rehypeRaw)
  .use(rehypeSanitize)
  .use(site)
  .use(rehypeStringify)
  .freeze();

export function markdown(source) {
  return String(processor.processSync(source));
}
