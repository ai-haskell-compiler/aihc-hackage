// Build HTML text with escaped values.
// The html tag escapes every interpolated value unless the value is a Raw fragment.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = value => String(value).replace(/[&<>"']/g, character => ESCAPES[character]);

class Raw {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}
export const raw = text => new Raw(text);
export function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}
export function html(strings, ...values) {
  let text = strings[0];
  for (let index = 0; index < values.length; index++) text += render(values[index]) + strings[index + 1];
  return new Raw(text);
}
