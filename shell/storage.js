export async function openStorage() {
  if (navigator.locks) {
    let ready;
    const acquired = new Promise(resolve => { ready = resolve; });
    // Hold the home-directory lock until this page closes.
    void navigator.locks.request('aihc-shell-home', { ifAvailable: true }, lock => {
      ready(Boolean(lock));
      return lock ? new Promise(() => {}) : undefined;
    });
    if (!await acquired) throw new Error('Another shell tab uses file storage.');
  }
  const request = indexedDB.open('aihc-shell', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('home');
  const database = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('aihc-shell') : null;
  return {
    async load() {
      const request = database.transaction('home').objectStore('home').get('files');
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error);
      });
    },
    async save(entries) {
      const transaction = database.transaction('home', 'readwrite');
      transaction.objectStore('home').put(entries, 'files');
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      channel?.postMessage('saved');
    },
    onExternalSave(callback) { if (channel) channel.onmessage = callback; },
  };
}
