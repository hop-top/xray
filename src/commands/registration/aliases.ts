import { Command } from 'commander';
import {
  aliasTargetErrors, circularAliases, kitAlias, splitAliasTarget, usableAliases,
} from '../../lib/alias-resolver';
import { CodeLoadingOptions, StrategyLoader } from '../../lib/strategy/loader';
import { StrategyContextImpl } from '../../lib/strategy/context';
import { StrategyCommand } from '../../lib/strategy/types';
import { Logger } from '../../lib/logger';
import { loadConfig } from '../../lib/config';
import { AliasCommandOptions } from '../../types/command-options';

export async function registerAliases(
  program: Command,
  options: CodeLoadingOptions = {},
  configPath?: string
): Promise<void> {
  const config = loadConfig(configPath, undefined, options);
  if (!config || !config.aliases || Object.keys(config.aliases).length === 0) {
    Logger.debug('No aliases configured');
    return;
  }

  const aliases = usableAliases(config);
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

  // Keep only aliases whose target resolves (already warned above).
  const strategyMap = new Map(strategies.map(s => [s.name, s]));
  const handlers = new Map<string, StrategyCommand>();
  for (const [alias, target] of Object.entries(aliases)) {
    const { strategyName, commandName } = splitAliasTarget(target);
    const cmdDef = strategyMap.get(strategyName)?.commands?.[commandName];
    if (cmdDef) handlers.set(alias, cmdDef);
  }
  const runnable = Object.fromEntries(
    Object.entries(aliases).filter(([alias]) => handlers.has(alias))
  );

  kitAlias.bridgeAliases(program, runnable, {
    hidden: false,
    describe: (_name, target) => `Alias for: ${target}`,
    helpOption: true,
    dispatch: (alias, target, cmd) =>
      runAlias(alias, target, handlers.get(alias)!, cmd.opts<AliasCommandOptions>()),
  });

  // Bridge proxies accept any arguments; xray aliases take only --path.
  for (const alias of handlers.keys()) {
    program.commands.find(c => c.name() === alias)!
      .option('-p, --path <path>', 'Project path', process.cwd())
      .allowExcessArguments(false);
  }

  Logger.debug(`Registered ${handlers.size} aliases`);
}

async function runAlias(
  alias: string,
  target: string,
  cmdDef: StrategyCommand,
  options: AliasCommandOptions
): Promise<void> {
  Logger.debug(`Executing alias "${alias}" → "${target}"`);

  const context = new StrategyContextImpl(options.path || process.cwd());

  try {
    const result = await cmdDef.handler(context, options);
    displayResult(target, result);
  } catch (error: any) {
    Logger.error(`Error executing alias "${alias}": ${error.message}`);
    process.exit(1);
  }
}

function displayResult(target: string, result: any): void {
  if (Array.isArray(result)) {
    Logger.output(`\n${target}:\n`);
    if (result.length === 0) {
      Logger.output('  (none found)');
    } else {
      result.forEach((item: any) => {
        Logger.output(`  ${item.name || item}`);
        if (item.file) console.log(`    → ${item.file}`);
      });
    }
    Logger.output(`\nTotal: ${result.length}\n`);
  } else if (typeof result === 'object') {
    Logger.output(JSON.stringify(result, null, 2));
  } else {
    Logger.output(result);
  }
}
