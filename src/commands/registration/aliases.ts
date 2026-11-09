import { Command } from 'commander';
import {
  aliasTargetErrors, circularAliases, kitAlias, warnAlias, reservedAliasNames, splitAliasTarget, usableAliases,
} from '../../lib/alias-resolver';
import { CodeLoadingOptions, StrategyLoader, reportSkippedProjectCode } from '../../lib/strategy/loader';
import { Logger } from '../../lib/logger';
import { jsonErrorsEnabled } from '../../lib/error/report';
import { loadConfig } from '../../lib/config';
import { AliasCommandOptions } from '../../types/command-options';
import { addResultFormat } from '../../lib/result-format';
import { declaredEffect, declareEffect, type Idempotency, type Tier } from '../side-effect';

export async function registerAliases(
  program: Command,
  options: CodeLoadingOptions = {},
  configPath?: string
): Promise<void> {
  const config = loadConfig(configPath);
  if (!config || !config.aliases || Object.keys(config.aliases).length === 0) {
    Logger.debug('No aliases configured');
    return;
  }

  const aliases = usableAliases(config, reservedAliasNames(program));
  const strategies = await new StrategyLoader(options).discoverStrategies();

  const errors = aliasTargetErrors(aliases, strategies);
  if (errors.length > 0) {
    if (!jsonErrorsEnabled()) Logger.warn('Alias validation errors:');
    errors.forEach(err => warnAlias(err, `  - ${err}`));
    // An alias may target a command of a strategy that was not loaded.
    reportSkippedProjectCode('warn', options);
  }

  const circular = circularAliases(aliases);
  if (circular.length > 0) {
    warnAlias(`Circular alias references detected: ${circular.join(', ')}`);
    return;
  }

  // Keep only aliases whose target resolves to a registered command
  // (unknown targets already warned above).
  const targets = new Map<string, Command>();
  for (const [alias, target] of Object.entries(aliases)) {
    const cmd = findTargetCommand(program, target);
    if (cmd) targets.set(alias, cmd);
  }
  const runnable = Object.fromEntries(
    Object.entries(aliases).filter(([alias]) => targets.has(alias))
  );

  kitAlias.bridgeAliases(program, runnable, {
    hidden: false,
    describe: (_name, target) => `Alias for: ${target}`,
    helpOption: true,
    dispatch: (alias, target, cmd) =>
      runAlias(alias, target, targets.get(alias)!, cmd.opts<AliasCommandOptions>()),
  });

  // Bridge proxies accept any arguments; xray aliases take only --path.
  // An alias does exactly what its target does, so it declares the same.
  for (const [alias, target] of targets) {
    const proxy = addResultFormat(program.commands.find(c => c.name() === alias)!
      .option('-p, --path <path>', 'Project path (default: current directory)')
      .allowExcessArguments(false),
      'Output format, passed to the target command (default: its own)');
    const { tier, idempotent } = declaredEffect(target);
    if (tier && idempotent) declareEffect(proxy, tier as Tier, idempotent as Idempotency);
  }

  Logger.debug(`Registered ${targets.size} aliases`);
}

/** The registered `<strategy> <command>` command for an alias target. */
function findTargetCommand(program: Command, target: string): Command | undefined {
  const { strategyName, commandName } = splitAliasTarget(target);
  return program.commands
    .find(c => c.name() === strategyName)
    ?.commands.find(c => c.name() === commandName);
}

/**
 * Run the target through its own registered action so detect, analyze,
 * handler and output emit match the direct invocation.
 */
async function runAlias(
  alias: string,
  target: string,
  targetCmd: Command,
  options: AliasCommandOptions
): Promise<void> {
  Logger.debug(`Executing alias "${alias}" → "${target}"`);
  const args = ['--path', options.path || process.cwd()];
  if (options.format !== undefined) args.push('--format', options.format);
  await targetCmd.parseAsync(args, { from: 'user' });
}
