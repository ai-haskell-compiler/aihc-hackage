let database;
async function open() {
  if (!database) database = new Promise((accept, reject) => {
    const request = indexedDB.open('aihc-documentation', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('files'); request.result.createObjectStore('results'); };
    request.onsuccess = () => accept(request.result); request.onerror = () => reject(request.error);
  });
  return database;
}
export async function saved(store, key, value) {
  try {
    const db = await open();
    return await new Promise((accept, reject) => {
      const tx = db.transaction(store, value === undefined ? 'readonly' : 'readwrite');
      const request = value === undefined ? tx.objectStore(store).get(key) : tx.objectStore(store).put(value, key);
      tx.oncomplete = () => accept(value === undefined ? request.result : true);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } catch { return undefined; }
}
export async function forget(store, key) {
  try {
    const db = await open();
    await new Promise((accept, reject) => {
      const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key);
      tx.oncomplete = accept; tx.onerror = reject;
    });
  } catch { /* A visitor can disable browser storage. */ }
}
