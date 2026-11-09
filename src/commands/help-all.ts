/**
 * `xray --help-all`: the whole command tree with each command's flags.
 *
 * Built from the same document `describe` emits, so the two never
 * disagree on what exists. Hidden commands are left out.
 */
import { Command, CommanderError } from 'commander';
import { Logger } from '../lib/logger';
import { buildDescribeDoc } from './describe';

type Doc = ReturnType<typeof buildDescribeDoc>;
type CommandDoc = Doc['commands'][number];

function flagTerm(o: CommandDoc['options'][number]): string {
  const arg = o.type === 'boolean' ? '' : o.type === 'number' ? ' <number>' : ' <value>';
  return `${o.short ? `${o.short}, ` : ''}${o.name}${arg}`;
}

function usageOf(c: CommandDoc): string {
  const args = c.arguments.map((a) => {
    const n = a.name + (a.variadic ? '...' : '');
    return a.required ? `<${n}>` : `[${n}]`;
  });
  return [c.qualifiedName.replace(/\./g, ' '), ...args].join(' ');
}

function render(c: CommandDoc, out: string[]): void {
  if (c.hidden) return;
  out.push(usageOf(c) + (c.description ? `  ${c.description}` : ''));
  const terms = c.options.map(flagTerm);
  const width = terms.reduce((m, t) => Math.max(m, t.length), 0);
  c.options.forEach((o, i) => {
    out.push(`  ${terms[i].padEnd(width)}${o.description ? `  ${o.description}` : ''}`.trimEnd());
  });
  for (const sub of c.subcommands) render(sub, out);
}

/** Text of the full tree under `root`. */
export function renderHelpAll(root: Command, version: string): string {
  const doc = buildDescribeDoc(root, root.name(), version);
  const out: string[] = [`${doc.tool} ${doc.version}: every command and its flags`, ''];
  for (const c of doc.commands) {
    if (c.hidden) continue;
    render(c, out);
    out.push('');
  }
  return out.join('\n').trimEnd();
}

/** Wire `--help-all` onto the root: print the tree, exit 0. */
export function registerHelpAll(program: Command, version: string): void {
  program.option('--help-all', 'Show every command with its flags');
  program.on('option:help-all', () => {
    Logger.output(renderHelpAll(program, version));
    throw new CommanderError(0, 'commander.helpDisplayed', '');
  });
}
