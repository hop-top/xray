import { Command } from 'commander';
import {
  aliasTargetErrors, circularAliases, kitAlias, reservedAliasNames, splitAliasTarget, usableAliases,
} from '../../lib/alias-resolver';
import { CodeLoadingOptions, StrategyLoader } from '../../lib/strategy/loader';
import { Logger } from '../../lib/logger';
import { loadConfig } from '../../lib/config';
import { AliasCommandOptions } from '../../types/command-options';

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
    Logger.warn('Alias validation errors:');
    errors.forEach(err => Logger.warn(`  - ${err}`));
  }

  const circular = circularAliases(aliases);
  if (circular.length > 0) {
    Logger.warn(`Circular alias references detected: ${circular.join(', ')}`);
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
  for (const alias of targets.keys()) {
    program.commands.find(c => c.name() === alias)!
      .option('-p, --path <path>', 'Project path', process.cwd())
      .allowExcessArguments(false);
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
  await targetCmd.parseAsync(['--path', options.path || process.cwd()], { from: 'user' });
}
