import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { FileSystem, normalize } from './filesystem.js';
import { Processes } from './processes.js';
import { Shell } from './shell.js';
import { openStorage } from './storage.js';
import { textBytes } from './codec.js';

const element = id => document.getElementById(id);
const terminal = new Terminal({ fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: 13,
  cursorBlink: true, convertEol: true, screenReaderMode: true, scrollback: 3000, allowProposedApi: false });
const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(element('terminal'));
const status = text => { element('runtime-status').textContent = text; };
// /theme.js sets the page theme. Copy the active colors into the terminal.
function setTheme() {
  const styles = getComputedStyle(document.documentElement);
  const color = name => styles.getPropertyValue(name).trim();
  terminal.options.theme = { background: color('--surface'), foreground: color('--text'), cursor: color('--accent'),
    selectionBackground: color('--soft-accent'), black: color('--text'), brightBlack: color('--muted'),
    magenta: color('--accent'), brightMagenta: color('--strong-accent') };
}
new MutationObserver(setTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', setTheme); setTheme();
new ResizeObserver(() => fit.fit()).observe(element('terminal'));
await document.fonts.ready; fit.fit();

if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
  status('This browser cannot start the shell.');
  terminal.writeln('The shell needs cross-origin isolation and SharedArrayBuffer.');
  terminal.writeln('Open this page directly in a current browser.');
} else {
  const fs = new FileSystem();
  let storage;
  try { storage = await openStorage(); fs.restore(await storage.load()); element('storage-status').textContent = 'Home files saved in this browser'; }
  catch (error) { element('storage-status').textContent = 'Temporary storage only'; terminal.writeln(`File storage is not available: ${error.message}`); }
  if (!fs.node('/home/user').contents.has('hello.c')) fs.write('/home/user/hello.c', '#include <stdio.h>\nint main(void) { puts("Hello browser"); return 0; }\n');
  let saving = Promise.resolve();
  const save = () => {
    if (!storage) return Promise.resolve();
    const snapshot = fs.snapshot();
    saving = saving.then(() => storage.save(snapshot)).catch(error => {
      element('storage-status').textContent = 'Files could not be saved'; terminal.writeln(`File storage failed: ${error.message}`);
    });
    return saving;
  };
  storage?.onExternalSave(() => { element('storage-status').textContent = 'Another tab saved files. Download files before reloading.'; });
  let busy = false, line = '', historyIndex = 0;
  const history = [];
  const output = value => terminal.write(value);
  const processes = new Processes(fs, output);
  const shell = new Shell(fs, processes, output, save, status);
  const prompt = () => { element('cwd').textContent = shell.cwd; terminal.write(`\x1b[35m${shell.cwd.replace('/home/user', '~')}\x1b[0m $ `); };
  async function submit(command) {
    if (busy) return;
    busy = true; element('stop').disabled = false; element('example').disabled = true;
    try { await shell.execute(command); }
    finally { busy = false; line = ''; element('stop').disabled = true; element('example').disabled = false; status('WASI ready'); prompt(); }
  }
  const replaceLine = value => { terminal.write('\b \b'.repeat([...line].length)); line = value; terminal.write(line); };
  terminal.onData(data => {
    if (data === '\x03') { if (busy) shell.interrupt(); else { line = ''; terminal.write('^C\r\n'); prompt(); } return; }
    if (busy) {
      if (data === '\x04') { shell.endInput(); return; }
      if (data.startsWith('\x1b')) return;
      for (const character of data) {
        if (character === '\r' || character === '\n') {
          if (!shell.input(textBytes(line + '\n'))) terminal.writeln('\r\nProgram input is not available.');
          else terminal.write('\r\n');
          line = '';
        } else if (character === '\x7f') { if (line) { line = [...line].slice(0, -1).join(''); terminal.write('\b \b'); } }
        else if (character >= ' ') { line += character; terminal.write(character); }
      }
      return;
    }
    if (data === '\x1b[A') { historyIndex = Math.max(0, historyIndex - 1); replaceLine(history[historyIndex] || ''); return; }
    if (data === '\x1b[B') { historyIndex = Math.min(history.length, historyIndex + 1); replaceLine(history[historyIndex] || ''); return; }
    if (data.startsWith('\x1b')) return;
    for (const character of data) {
      if (busy) break;
      if (character === '\r' || character === '\n') {
        const command = line; line = ''; terminal.write('\r\n');
        if (command.trim()) { history.push(command); historyIndex = history.length; void submit(command); }
        else prompt();
      } else if (character === '\x7f') { if (line) { line = [...line].slice(0, -1).join(''); terminal.write('\b \b'); } }
      else if (character >= ' ') { line += character; terminal.write(character); }
    }
  });
  element('stop').onclick = () => shell.interrupt();
  element('example').onclick = () => { replaceLine('clang hello.c -o hello.wasm; ./hello.wasm'); const command = line; line = ''; terminal.write('\r\n'); void submit(command); };
  element('upload').onclick = () => element('files').click();
  element('files').onchange = async event => {
    try {
      for (const file of event.target.files) {
        if (file.size > 128 * 1024 * 1024) throw new Error('The file exceeds 128 MiB.');
        fs.write(normalize(file.name, shell.cwd), new Uint8Array(await file.arrayBuffer()));
        terminal.writeln(`\r\nUploaded ${file.name}`);
      }
      await save();
    } catch (error) { terminal.writeln(error.message); }
    event.target.value = ''; if (!busy) { line = ''; prompt(); } terminal.focus();
  };
  element('download').onclick = () => {
    element('download-form').hidden = false;
    element('download-path').value = `${shell.cwd}/hello.c`;
    element('download-path').focus();
  };
  element('download-cancel').onclick = () => { element('download-form').hidden = true; terminal.focus(); };
  element('download-form').onsubmit = event => {
    event.preventDefault();
    const path = element('download-path').value;
    try {
      const bytes = fs.read(normalize(path, shell.cwd));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = path.split('/').pop(); link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      element('download-form').hidden = true; terminal.focus();
    } catch (error) { terminal.writeln(`\r\n${error.message}`); if (!busy) { line = ''; prompt(); } }
  };
  await save(); status('WASI ready');
  terminal.writeln('AIHC Shell · WASI Preview 1');
  terminal.writeln('Enter help for commands. Start with ls or the C example.\r\n');
  prompt(); terminal.focus();
}
