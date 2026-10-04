export const DOCUMENT_KINDS = ['readme', 'changelog'];
const MAX_DOCUMENT = 1024 * 1024;

export async function contentDigest(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function importDocuments(name, version, env, limitedBytes) {
  const previous = await env.DB.prepare('SELECT kind, status FROM package_documents WHERE name=? AND version=?')
    .bind(name, version).all();
  return Promise.all(DOCUMENT_KINDS.map(async kind => {
    if (previous.results.some(row => row.kind === kind && row.status !== 'failed')) return null;
    const sourceUrl = `https://hackage.haskell.org/package/${name}-${version}/${kind}.txt`;
    let status = 'missing';
    let bytes;
    let error = null;
    try {
      const response = await fetch(sourceUrl, {
        redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'text/plain', 'User-Agent': 'aihc-hackage/0.1 (https://hackage.aihc.app)' },
      });
      if (response.status === 404) await response.body?.cancel();
      else if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Hackage could not supply the document. Import this version again to try again.');
      } else {
        bytes = await limitedBytes(response, MAX_DOCUMENT);
        status = 'available';
      }
    } catch (failure) {
      status = 'failed';
      error = failure.status === 413
        ? 'The document is larger than the one MiB size limit.'
        : 'Hackage could not supply the document. Import this version again to try again.';
    }
    // Storage errors stop the import before the database changes.
    const sha256 = bytes ? await contentDigest(bytes) : null;
    const objectKey = bytes ? `documents/${name}/${version}/${kind}/${sha256}.txt` : null;
    if (bytes) await env.CABAL.put(objectKey, bytes, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    return env.DB.prepare(`INSERT INTO package_documents (name, version, kind, status, object_key, sha256, error, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name, version, kind) DO UPDATE SET status=excluded.status, object_key=excluded.object_key,
      sha256=excluded.sha256, error=excluded.error, checked_at=excluded.checked_at
      WHERE package_documents.status='failed'`)
      .bind(name, version, kind, status, objectKey, sha256, error, new Date().toISOString());
  }));
}

export async function documentMetadata(name, version, env) {
  const rows = await env.DB.prepare('SELECT kind, status, sha256, error, checked_at FROM package_documents WHERE name=? AND version=?')
    .bind(name, version).all();
  return Object.fromEntries(DOCUMENT_KINDS.map(kind => {
    const row = rows.results.find(row => row.kind === kind);
    return [kind, row ? { status: row.status, sha256: row.sha256, error: row.error, checkedAt: row.checked_at }
      : { status: 'not_imported' }];
  }));
}
