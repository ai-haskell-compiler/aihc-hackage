import { Directory, OpenFile, wasi } from '@bjorn3/browser_wasi_shim';
import { normalize } from './filesystem.js';
import { parse } from './parser.js';
import { Pipe } from './pipe.js';
import { utilities } from './processes.js';
import { loadToolchain } from './toolchain.js';
import { textBytes } from './codec.js';

export class Shell {
  constructor(fs, processes, output, save, status) {
    Object.assign(this, { fs, processes, output, save, status });
    this.cwd = '/home/user'; this.lastCode = 0; this.jobs = new Map(); this.nextJob = 1;
    this.foreground = [];
    for (const name of utilities) fs.write(`/bin/${name}`, `Shell utility: ${name}\n`, false, true);
    for (const name of ['clang', 'wasm-ld']) fs.write(`/bin/${name}`, `Packaged WASI command: ${name}\n`, false, true);
    this.env = { HOME: this.cwd, USER: 'user', PATH: '/bin', PWD: this.cwd, TERM: 'xterm-256color' };
  }
  interrupt() { for (const process of this.foreground) if (this.processes.running.has(process.pid)) this.processes.kill(process.pid); }
  input(bytes) { return this.inputPipe?.writeAvailable(bytes); }
  endInput() { this.inputPipe?.closeWriter(); }
  async execute(line) {
    try {
      for (const job of parse(line, { ...this.env, '?': String(this.lastCode) })) {
        const name = job.commands[0].argv[0];
        if (['cd', 'wait', 'jobs', 'ps', 'kill', 'help', 'clear'].includes(name)) {
          if (job.commands.length !== 1 || job.background || job.commands[0].input || job.commands[0].output) throw new Error('Run this shell command without pipes or file operators.');
          this.lastCode = await this.control(name, job.commands[0].argv.slice(1));
        } else {
          const task = await this.pipeline(job.commands, job.background);
          if (job.background) {
            const id = this.nextJob++; this.jobs.set(id, task);
            this.output(`[${id}] ${task.processes.map(p => p.pid).join(' ')}\n`);
            task.done.then(code => { task.code = code; this.output(`\r\n[${id}] Complete (${code})\n`); });
          } else { this.foreground = task.processes; this.lastCode = await task.done; this.foreground = []; this.inputPipe = null; }
        }
      }
      await this.save();
    } catch (error) { this.output(`${error.message}\n`); this.lastCode = 1; }
    return this.lastCode;
  }
  async control(name, args) {
    if (name === 'cd') {
      const path = normalize(args[0] || this.env.HOME, this.cwd);
      if (!(this.fs.node(path) instanceof Directory)) throw new Error('The path is not a directory.');
      this.cwd = path; this.env.PWD = path;
    } else if (name === 'wait') {
      const tasks = args.length ? args.map(id => this.jobs.get(Number(id))) : [...this.jobs.values()];
      if (tasks.some(task => !task)) throw new Error('The job does not exist.');
      const codes = await Promise.all(tasks.map(task => task.done));
      for (const [id, task] of this.jobs) if (tasks.includes(task)) this.jobs.delete(id);
      await this.save();
      return codes.at(-1) || 0;
    } else if (name === 'jobs') this.output([...this.jobs].map(([id, task]) => `[${id}] ${task.code === undefined ? 'Running' : `Complete (${task.code})`} ${task.label}`).join('\n') + '\n');
    else if (name === 'ps') this.output('PID  COMMAND\n' + [...this.processes.running.values()].map(p => `${p.pid}  ${p.argv.join(' ')}`).join('\n') + '\n');
    else if (name === 'kill') { if (!args.length) throw new Error('Enter a process ID.'); args.forEach(pid => this.processes.kill(pid)); }
    else if (name === 'clear') this.output('\x1b[2J\x1b[H');
    else this.output('Commands: ls cat cp mv rm mkdir pwd echo env which touch\nShell: cd jobs ps kill wait clear help\nOperators: | < > >> & ;   Quotes: single or double\nRun a WASI Preview 1 file: ./program.wasm [arguments]\nC example: clang hello.c -o hello.wasm; ./hello.wasm\nclang -c makes an object file. wasm-ld links object files.\nUse Upload to add source files or WASI programs.\nUse Ctrl+D to close program input. Background input is closed.\nFiles in /home/user are saved in this browser. /tmp is temporary.\nAIHC, networking, fork, and WASI components are not installed.\n');
    return 0;
  }
  async resolve(name, cwd) {
    if (utilities.includes(name) || name.startsWith('/bin/') && utilities.includes(name.slice(5))) return { builtin: name.split('/').pop() };
    if (['clang', 'wasm-ld', '/bin/clang', '/bin/wasm-ld'].includes(name)) {
      if (!this.toolchain) this.toolchain = loadToolchain(this.fs, this.status).catch(error => { this.toolchain = null; throw error; });
      const modules = await this.toolchain; return { module: modules[name.endsWith('clang') ? 0 : 1], compiler: name.endsWith('clang') };
    }
    const path = name.includes('/') ? normalize(name, cwd) : `/bin/${name}`;
    const bytes = this.fs.read(path);
    // Compile each invocation so that replaced files take effect.
    return { module: await WebAssembly.compile(bytes) };
  }
  async pipeline(commands, background) {
    const cwd = this.cwd;
    const prepared = await Promise.all(commands.map(async command => ({ ...command, ...await this.resolve(command.argv[0], cwd) })));
    const pipes = prepared.slice(1).map(() => new Pipe());
    this.inputPipe = null;
    if (!background && !prepared[0].input && (!prepared[0].builtin || prepared[0].builtin === 'cat' && prepared[0].argv.length === 1)) this.inputPipe = new Pipe();
    const processes = [];
    const env = Object.entries(this.env).map(([key, value]) => `${key}=${value}`);
    const start = (module, argv, stdin, stdout, builtin, onOutput) => {
      const process = this.processes.spawn(module, argv, env, cwd, stdin, stdout, onOutput, builtin);
      processes.push(process); return process;
    };
    try {
      const completions = prepared.map((command, i) => {
        const stdin = command.input ? { bytes: this.fs.read(normalize(command.input, cwd)) } :
          i ? { pipe: pipes[i - 1].buffer } : this.inputPipe && !background ? { pipe: this.inputPipe.buffer } : { bytes: new Uint8Array() };
        const stdout = command.output ? { name: 'stdout' } : i < prepared.length - 1 ? { pipe: pipes[i].buffer } : { name: 'stdout' };
        // Close unused pipe endpoints when a file operator replaces them.
        if (command.input && i) pipes[i - 1].closeReader();
        if (command.output && i < pipes.length) pipes[i].closeWriter();
        const outputPath = command.output && normalize(command.output, cwd);
        if (outputPath) this.fs.write(outputPath, new Uint8Array(), command.append);
        const outputFile = outputPath && new OpenFile(this.fs.node(outputPath));
        const onOutput = (bytes, stream) => {
          if (outputFile && stream === 'stdout') { outputFile.fd_seek(0n, wasi.WHENCE_END); outputFile.fd_write(bytes); }
          else this.output(bytes);
        };
        if (!command.compiler || command.argv.includes('-cc1')) return start(command.module, command.argv, stdin, stdout, command.builtin, onOutput).done;
        return this.compile(command, stdin, stdout, start, onOutput, cwd).catch(error => { this.output(`${error.message}\n`); return 1; })
          .finally(() => { if (stdout.pipe) new Pipe(stdout.pipe).closeWriter(); });
      });
      const done = Promise.all(completions).then(async codes => { await this.save(); return codes.at(-1); });
      return { processes, done, label: commands.map(c => c.argv.join(' ')).join(' | ') };
    } catch (error) {
      for (const pipe of pipes) { pipe.closeReader(); pipe.closeWriter(); }
      for (const process of processes) if (this.processes.running.has(process.pid)) this.processes.kill(process.pid);
      throw error;
    }
  }
  async compile(command, stdin, stdout, start, onOutput, cwd) {
    const args = command.argv.slice(1);
    if (args.includes('--version')) return start(command.module, command.argv, stdin, stdout, undefined, onOutput).done;
    let output = 'a.wasm', input, objectOnly = false, optimization = '-O0';
    const extra = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-o') { output = args[++i]; if (!output) throw new Error('Enter an output path.'); }
      else if (args[i] === '-c') objectOnly = true;
      else if (/^-O[0123sz]$/.test(args[i])) optimization = args[i];
      else if (args[i] === '-x') extra.push(args[i], args[++i]);
      else if (args[i].startsWith('-I') || args[i].startsWith('-D') || args[i].startsWith('-std=')) extra.push(args[i]);
      else if (!input) input = args[i];
      else throw new Error('This Clang command supports one source file.');
    }
    if (!input) throw new Error('Enter a C source file.');
    if (objectOnly && output === 'a.wasm') output = input.replace(/\.[^.]+$/, '') + '.o';
    const object = objectOnly ? normalize(output, cwd) : `/tmp/compile-${crypto.randomUUID()}.o`;
    const compilerArgs = ['clang', '-cc1', '-triple', 'wasm32-unknown-wasi', '-emit-obj', '-disable-free',
      '-isysroot', '/usr', '-internal-isystem', '/usr/include', '-internal-isystem', '/usr/lib/clang/8.0.1/include',
      optimization, ...extra, '-o', object, input];
    const code = await start(command.module, compilerArgs, stdin, { name: 'stdout' }, undefined, onOutput).done;
    if (code || objectOnly) return code;
    try {
      const [, linker] = await this.toolchain;
      return await start(linker, ['wasm-ld', '--no-threads', '-z', 'stack-size=1048576',
        '-L/usr/lib/wasm32-wasi', '/usr/lib/wasm32-wasi/crt1.o', object, '-lc', '-o', normalize(output, cwd)],
      { bytes: textBytes('') }, stdout, undefined, onOutput).done;
    } finally { try { this.fs.remove(object); } catch { /* The compiler can fail before it creates the object. */ } }
  }
}
