// The Worker renders the pages. This script adds the import dialog and live search results.
const status = document.querySelector('#status');
const importDialog = document.querySelector('#import-dialog');
const importStatus = document.querySelector('#import-status');
const queryInput = document.querySelector('#query');
const encode = encodeURIComponent;
const packageHref = (name, version) => `/package/${encode(name)}/${encode(version)}`;
const searchHref = query => query ? `/search?q=${encode(query)}` : '/search';

function message(text, error = false) { status.textContent = text; status.className = error ? 'error' : ''; }
async function importPackage(name, version) {
  const response = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, version }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed.');
  return result;
}
function openImport(name = '', version = '') {
  document.querySelector('#import-name').value = name;
  document.querySelector('#import-version').value = version;
  importStatus.textContent = ''; importStatus.className = 'muted';
  importDialog.showModal();
  document.querySelector(name ? '#import-version' : '#import-name').focus();
}
document.querySelector('#open-import').onclick = () => openImport();
document.querySelector('#import-cancel').onclick = () => importDialog.close();
importDialog.addEventListener('click', event => { if (event.target === importDialog) importDialog.close(); });
document.querySelector('#import-form').onsubmit = async event => {
  event.preventDefault();
  const button = document.querySelector('#import-button'); button.disabled = true;
  const name = document.querySelector('#import-name').value.trim();
  const version = document.querySelector('#import-version').value.trim();
  importStatus.textContent = `Importing ${name}-${version} from Hackage. Please wait.`; importStatus.className = 'muted';
  try {
    const result = await importPackage(name, version);
    importStatus.textContent = 'The import is complete. Please wait for the package page.';
    location.assign(packageHref(result.name, result.version));
  } catch (error) { importStatus.textContent = error.message; importStatus.className = 'error'; button.disabled = false; }
};
// Buttons in the page content open the dialog or import the documents of the shown version again.
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-import-name]');
  if (!button) return;
  const { importName, importVersion } = button.dataset;
  if (!button.hasAttribute('data-import-reload')) { openImport(importName, importVersion); return; }
  button.disabled = true;
  message(`Importing ${importName}-${importVersion} from Hackage. Please wait.`);
  try { await importPackage(importName, importVersion); location.reload(); }
  catch (error) { message(error.message, true); button.disabled = false; }
});

// Show search results while the visitor types. The form also works without this script.
if (queryInput) {
  let timer;
  let requestNumber = 0;
  async function update() {
    const query = queryInput.value.trim();
    const number = ++requestNumber;
    try {
      const response = await fetch(searchHref(query), { headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Error('The search failed. Please try again.');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (number !== requestNumber) return;
      document.querySelector('#results').replaceWith(page.querySelector('#results'));
      document.title = page.title;
      history.replaceState(null, '', searchHref(query));
      message('');
    } catch (error) { if (number === requestNumber) message(error.message, true); }
  }
  queryInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 250); });
  if (document.activeElement === document.body) queryInput.focus({ preventScroll: true });
  document.querySelector('#search-form').addEventListener('submit', () => clearTimeout(timer));
}
