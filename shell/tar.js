import { bytesText } from './codec.js';

// Read a ustar archive. Each entry has a path, a kind of "directory" or "file", and bytes.
export function readTar(bytes) {
  const entries = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    const string = (start, end) => bytesText(header.subarray(start, end)).split('\0')[0];
    const name = string(0, 100).replace(/^\.\//, '');
    if (!name) break;
    const size = parseInt(string(124, 136).trim(), 8) || 0;
    if (offset + 512 + size > bytes.length || name.split('/').includes('..')) throw new Error('The archive is invalid.');
    const path = name.replace(/\/$/, '');
    if (header[156] === 53) entries.push({ path, kind: 'directory' });
    else if (header[156] === 48 || header[156] === 0) entries.push({ path, kind: 'file', bytes: bytes.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
