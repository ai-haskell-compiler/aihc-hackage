// Cloudflare Workers require all Wasm modules to be compiled at deployment.
// jco emits two small suspension adapters as inline byte arrays. Extract those arrays too.
export function externalizeWasm(files, name) {
  const path = `${name}.js`; let count = 0;
  const source = new TextDecoder().decode(files[path]);
  const patched = source.replace(/new WebAssembly\.Module\(new Uint8Array\(\[([\s\S]*?)\]\)\)/g, (_, values) => {
    const parts = values.split(',').map(part => part.trim()).filter(Boolean);
    if (!parts.every(part => /^(0x[0-9a-f]+|\d+)$/i.test(part) && Number(part) <= 255)) throw new Error('The generated Wasm adapter has an unsupported format.');
    const module = `${name}.adapter${count++}.wasm`;
    files[module] = Uint8Array.from(parts.map(Number));
    return `getCoreModule(${JSON.stringify(module)})`;
  });
  if (count !== 2) throw new Error('The generated suspension adapters changed. Review the Worker build.');
  files[path] = new TextEncoder().encode(patched);
}
