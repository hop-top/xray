/**
 * Shell completion via `@hop-top/kit/completion`.
 *
 * `xray completion bash|zsh|fish|powershell [--no-descriptions]` prints
 * kit's cobra-protocol scripts. Those scripts hold no command list: on
 * every tab they call `xray __complete <words...>`, which kit answers
 * from the live commander tree before commander parses (no hook or
 * action runs). Strategy commands and user aliases therefore complete
 * as soon as they are registered; scripts never go stale.
 *
 * Value completion (flag values, positional args) is bound here with
 * kit completers once the whole tree is registered.
 *
 * tsconfig uses legacy `node` module resolution, which ignores the
 * package `exports` map, so types come from the dist path while the
 * runtime require goes through the exported subpath.
 */
import { declareEffect } from './side-effect';
import type { Command } from 'commander';
import type * as KitCompletion from '@hop-top/kit/dist/completion';
import type * as KitValues from '@hop-top/kit/dist/completion-values';
import type { Completer, CompletionItem } from '@hop-top/kit/dist/completion-values';
import { UsageError } from '../lib/error/types';
import { setCommandGroup } from './kit-cli';
import { VERBOSITY_LEVELS } from './root-options';
import type { CodeLoadingOptions } from '../lib/strategy/loader';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const completion = require('@hop-top/kit/completion') as typeof KitCompletion;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const values = require('@hop-top/kit/completion-values') as typeof KitValues;

export const { bindFlag, bindArgs } = completion;
export const { staticValues, funcCompleter, fileCompleter, dirCompleter } = values;
export type { Completer, CompletionItem };

/** Whether argv (process.argv shape) is a shell completion request. */
export function isCompletionRequest(argv: readonly string[]): boolean {
  const first = argv[2];
  return first === completion.REQUEST_CMD || first === completion.NO_DESC_REQUEST_CMD;
}

/**
 * Add kit's `completion <shell>` command to `program` (MANAGEMENT group).
 * A missing or unknown shell is a usage error (exit 2) rather than
 * commander's help fallback.
 */
export function registerCompletionCommand(program: Command): Command {
  const cmd = completion.completionCommand(program);
  cmd.action((_opts: unknown, self: Command) => {
    const shells = completion.SHELLS.join(', ');
    const [shell] = self.args;
    throw new UsageError(
      shell
        ? `unsupported shell '${shell}' (expected one of: ${shells})`
        : `missing shell (expected one of: ${shells})`
    );
  });
  // One script per shell, printed to stdout.
  for (const shell of cmd.commands) declareEffect(shell, 'read', 'yes');
  program.addCommand(cmd);
  setCommandGroup(cmd, 'management');
  return cmd;
}

/** Values of `-w, --with <feature>` on analysis commands. */
const WITH_FEATURES = ['vars', 'incs', 'cost', 'docs', 'df', 'cf'];

/** Values of `--group <mode>` on analysis commands. */
const GROUP_MODES = ['directory', 'community'];

/** Language pack names + bundles (`lang add`, `--lang`). */
function languageItems(): CompletionItem[] {
  // Lazy: only loaded on a completion request.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { LANGUAGE_PACKS, BUNDLES } = require('../lib/parser/grammars') as typeof import('../lib/parser/grammars');
  return [
    ...LANGUAGE_PACKS.map((p) => ({ value: p.name, description: p.extensions.join(' ') })),
    ...Object.entries(BUNDLES).map(([name, langs]) => ({
      value: name,
      description: `bundle: ${langs.join(', ')}`,
    })),
  ];
}

/** Case-insensitive prefix filter (funcCompleter sees the raw prefix). */
function byPrefix(items: CompletionItem[], prefix: string): CompletionItem[] {
  const p = prefix.toLowerCase();
  return items.filter((i) => i.value.toLowerCase().startsWith(p));
}

const languageCompleter = funcCompleter((prefix) => byPrefix(languageItems(), prefix));

/** `--lang a,b,<tab>`: complete the last comma-separated element. */
const languageListCompleter = funcCompleter((prefix) => {
  const cut = prefix.lastIndexOf(',') + 1;
  const head = prefix.slice(0, cut);
  return byPrefix(languageItems(), prefix.slice(cut)).map((i) => ({
    value: head + i.value,
    description: i.description,
  }));
});

/** Installed/built-in strategy names (`strategy info|remove|validate`). */
function strategyCompleter(options: CodeLoadingOptions): Completer {
  return funcCompleter(async (prefix) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { StrategyLoader } = require('../lib/strategy/loader') as typeof import('../lib/strategy/loader');
    const strategies = await new StrategyLoader(options).discoverStrategies();
    const items = strategies.map((s) => ({ value: s.name, description: `v${s.version}` }));
    return byPrefix(items, prefix);
  });
}

/** Flag completers bound on every command declaring the flag. */
const FLAG_COMPLETERS: Record<string, () => Completer> = {
  'log-level': () => staticValues(...VERBOSITY_LEVELS),
  config: () => fileCompleter(),
  chdir: () => dirCompleter(),
  path: () => dirCompleter(),
  dir: () => dirCompleter(),
  output: () => fileCompleter(),
  anchor: () => fileCompleter(),
  graph: () => fileCompleter('json'),
  with: () => staticValues(...WITH_FEATURES),
  group: () => staticValues(...GROUP_MODES),
  lang: () => languageListCompleter,
};

/** Positional-argument completers, by command path below the root. */
const ARG_COMPLETERS: Record<string, (options: CodeLoadingOptions) => Completer> = {
  'strategy info': strategyCompleter,
  'strategy remove': strategyCompleter,
  'strategy validate': strategyCompleter,
  'lang add': () => languageCompleter,
  'lang remove': () => languageCompleter,
};

function commandPath(cmd: Command): string {
  const parts: string[] = [];
  for (let c: Command | null = cmd; c && c.parent; c = c.parent) parts.unshift(c.name());
  return parts.join(' ');
}

/**
 * Bind value completers across the registered tree. Call once after
 * every command (core, strategy, alias) is registered. `--format`
 * values are bound where each command declares its formats.
 * `options` governs which strategy code the name completer may load.
 */
export function bindValueCompleters(program: Command, options: CodeLoadingOptions = {}): void {
  const visit = (cmd: Command) => {
    for (const opt of cmd.options) {
      const name = opt.long?.replace(/^--/, '');
      if (!name || !opt.required && !opt.optional) continue;
      const make = FLAG_COMPLETERS[name];
      if (make) bindFlag(cmd, name, make());
    }
    const args = ARG_COMPLETERS[commandPath(cmd)];
    if (args) bindArgs(cmd, args(options));
    for (const sub of cmd.commands) visit(sub);
  };
  visit(program);
}
