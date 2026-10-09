import { MAX_UNPACKED } from './contract.js';

export async function boundedBytes(stream, limit) {
  const reader = stream.getReader(); const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error('The file exceeds the size limit.'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export async function decompress(bytes, limit = MAX_UNPACKED) {
  return boundedBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), limit);
}

// Reject links, duplicate paths, unsafe names, and malformed tar headers.
export function sourceEntries(bytes, prefix, maxFiles = 20000) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = []; const names = new Set(); let longName;
  const string = part => decoder.decode(part.subarray(0, part.indexOf(0) < 0 ? part.length : part.indexOf(0)));
  const octal = part => { const value = string(part).trim(); if (!/^[0-7]+$/.test(value)) throw new Error('The archive header is invalid.'); return parseInt(value, 8); };
  let offset = 0; let ended = false;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512); offset += 512;
    if (header.every(value => value === 0)) { ended = true; break; }
    const sum = header.reduce((n, value, index) => n + (index >= 148 && index < 156 ? 32 : value), 0);
    if (octal(header.subarray(148, 156)) !== sum) throw new Error('The archive header checksum is invalid.');
    const size = octal(header.subarray(124, 136));
    if (size > MAX_UNPACKED || offset + size > bytes.length) throw new Error('The archive is incomplete.');
    const data = bytes.subarray(offset, offset + size); offset += Math.ceil(size / 512) * 512;
    const type = header[156];
    if (type === 76) { if (longName || size > 4096) throw new Error('The archive name is invalid.'); longName = string(data); continue; }
    const base = string(header.subarray(0, 100)); const parent = string(header.subarray(345, 500));
    const name = (longName || `${parent ? `${parent}/` : ''}${base}`).replace(/\/$/, ''); longName = undefined;
    if (!name || name.length > 4096 || /[\\\x00-\x1f\x7f]/.test(name) || name.startsWith('/')
      || name.split('/').some(part => !part || part === '.' || part === '..') || (name !== prefix && !name.startsWith(`${prefix}/`))) throw new Error('The archive contains an unsafe path.');
    if (names.has(name)) throw new Error('The archive contains a duplicate path.');
    names.add(name);
    if (names.size > maxFiles) throw new Error('The archive exceeds the file limit.');
    if (type === 53 && size === 0) continue;
    if (type !== 48 && type !== 0) throw new Error('The archive contains an unsupported entry.');
    if (name === prefix) throw new Error('The archive root must be a directory.');
    entries.push({ path: name.slice(prefix.length + 1), bytes: data });
  }
  if (!ended || longName || bytes.subarray(offset).some(value => value !== 0)) throw new Error('The archive has an invalid end marker.');
  return entries;
}
