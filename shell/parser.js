export function parse(line, env = {}) {
  const tokens = [];
  let word = '', started = false, quote = '';
  const push = () => { if (started) tokens.push({ word }); word = ''; started = false; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && quote !== "'") {
      if (++i === line.length) throw new Error('The escape is incomplete.');
      word += line[i]; started = true;
    } else if (c === quote) { quote = ''; }
    else if (!quote && (c === '"' || c === "'")) { quote = c; started = true; }
    else if (c === '$' && quote !== "'") {
      const match = /^(\?|[A-Za-z_][A-Za-z0-9_]*)/.exec(line.slice(i + 1));
      if (match) { word += env[match[0]] || ''; i += match[0].length; started = true; }
      else word += c;
    } else if (!quote && /\s/.test(c)) push();
    else if (!quote && '|&<>;'.includes(c)) {
      push(); let operator = c;
      if (line[i + 1] === c && ['>', '|', '&', '<'].includes(c)) operator += line[++i];
      if (['||', '&&', '<<'].includes(operator)) throw new Error('This shell does not support this operator.');
      tokens.push({ operator });
    } else if (!quote && c === '#' && !started) break;
    else { word += c; started = true; }
  }
  if (quote) throw new Error('Close the quoted text.');
  push();
  const jobs = [];
  let job = { commands: [], background: false }, command = { argv: [] };
  const endCommand = () => {
    if (!command.argv.length) throw new Error('Enter a command.');
    job.commands.push(command); command = { argv: [] };
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.word !== undefined) command.argv.push(token.word);
    else if (['<', '>', '>>'].includes(token.operator)) {
      const target = tokens[++i];
      if (!target || target.word === undefined) throw new Error('Enter a file path after the operator.');
      if (token.operator === '<') command.input = target.word;
      else { command.output = target.word; command.append = token.operator === '>>'; }
    } else if (token.operator === '|') endCommand();
    else {
      endCommand(); job.background = token.operator === '&'; jobs.push(job);
      job = { commands: [], background: false };
    }
  }
  if (command.argv.length) { endCommand(); jobs.push(job); }
  else if (job.commands.length || command.input || command.output) throw new Error('Enter a command after the operator.');
  return jobs;
}
