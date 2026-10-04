// The theme control matches the AIHC manual: system, light, and dark modes in a cycle.
// The icons are from Material Design Icons (Apache License 2.0), as used by the manual.
(() => {
  const KEY = 'aihc-theme';
  const MODES = ['system', 'light', 'dark'];
  const BACKGROUND = { light: '#faf8f3', dark: '#151318' };
  const ICONS = {
    system: 'm14.3 16-.7-2h-3.2l-.7 2H7.8L11 7h2l3.2 9zM20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12zm-9.15 3.96h2.3L12 9z',
    light: 'M12 7a5 5 0 0 1 5 5 5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3m0-7 2.39 3.42C13.65 5.15 12.84 5 12 5s-1.65.15-2.39.42zM3.34 7l4.16-.35A7.2 7.2 0 0 0 5.94 8.5c-.44.74-.69 1.5-.83 2.29zm.02 10 1.76-3.77a7.131 7.131 0 0 0 2.38 4.14zM20.65 7l-1.77 3.79a7.02 7.02 0 0 0-2.38-4.15zm-.01 10-4.14.36c.59-.51 1.12-1.14 1.54-1.86.42-.73.69-1.5.83-2.29zM12 22l-2.41-3.44c.74.27 1.55.44 2.41.44.82 0 1.63-.17 2.37-.44z',
    dark: 'm17.75 4.09-2.53 1.94.91 3.06-2.63-1.81-2.63 1.81.91-3.06-2.53-1.94L12.44 4l1.06-3 1.06 3zm3.5 6.91-1.64 1.25.59 1.98-1.7-1.17-1.7 1.17.59-1.98L15.75 11l2.06-.05L18.5 9l.69 1.95zm-2.28 4.95c.83-.08 1.72 1.1 1.19 1.85-.32.45-.66.87-1.08 1.27C15.17 23 8.84 23 4.94 19.07c-3.91-3.9-3.91-10.24 0-14.14.4-.4.82-.76 1.27-1.08.75-.53 1.93.36 1.85 1.19-.27 2.86.69 5.83 2.89 8.02a9.96 9.96 0 0 0 8.02 2.89m-1.64 2.02a12.08 12.08 0 0 1-7.8-3.47c-2.17-2.19-3.33-5-3.49-7.82-2.81 3.14-2.7 7.96.31 10.98 3.02 3.01 7.84 3.12 10.98.31',
  };
  const NEXT_LABEL = { system: 'Use the light mode', light: 'Use the dark mode', dark: 'Use the system mode' };
  const media = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';
  try { mode = localStorage.getItem(KEY) || 'system'; } catch { /* The browser can disable local storage. */ }
  if (!MODES.includes(mode)) mode = 'system';

  function apply() {
    const root = document.documentElement;
    if (mode === 'system') delete root.dataset.theme; else root.dataset.theme = mode;
    const active = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.content = mode === 'system' ? BACKGROUND[meta.media.includes('dark') ? 'dark' : 'light'] : BACKGROUND[active];
    }
    const button = document.querySelector('#theme');
    if (!button) return;
    button.title = NEXT_LABEL[mode];
    button.setAttribute('aria-label', `${NEXT_LABEL[mode]}. The current mode is ${mode}.`);
    button.querySelector('path').setAttribute('d', ICONS[mode]);
  }
  apply();
  media.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelector('#theme')?.addEventListener('click', () => {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem(KEY, mode); } catch { /* Theme changes still work without storage. */ }
      apply();
    });
  });
})();
