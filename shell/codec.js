const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const encode = value => encoder.encode(JSON.stringify(value, (_key, item) =>
  typeof item === 'bigint' ? { type: 'bigint', value: String(item) } : item instanceof Uint8Array ? { type: 'bytes', value: Array.from(item) } : item));
export const decode = bytes => JSON.parse(decoder.decode(bytes.slice()), (_key, item) =>
  item?.type === 'bigint' ? BigInt(item.value) : item?.type === 'bytes' ? Uint8Array.from(item.value) : item);
export const textBytes = text => encoder.encode(text);
export const bytesText = bytes => decoder.decode(bytes);
