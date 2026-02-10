import { Command } from 'commander';
import { AliasResolver } from '../../lib/alias-resolver';
import { StrategyLoader } from '../../lib/strategy/loader';
import { StrategyContextImpl } from '../../lib/strategy/context';
import { Logger } from '../../lib/logger';
import { loadConfig } from '../../lib/config';
import { AliasCommandOptions } from '../../types/command-options';

export async function registerAliases(program: Command): Promise<void> {
  const config = loadConfig();
  if (!config || !config.aliases || Object.keys(config.aliases).length === 0) {
    Logger.debug('No aliases configured');
    return;
  }

  const resolver = new AliasResolver(config);
  const loader = new StrategyLoader();

  // Validate aliases
  const errors = await resolver.validateAliases(loader);
  if (errors.length > 0) {
    Logger.warn('Alias validation errors:');
    errors.forEach(err => Logger.warn(`  - ${err}`));
  }

  // Detect circular references
  const circular = resolver.detectCircular();
  if (circular.length > 0) {
    Logger.warn(`Circular alias references detected: ${circular.join(', ')}`);
    return;
  }

  // Load strategies once for all aliases
  const strategies = await loader.discoverStrategies();
  const strategyMap = new Map(strategies.map(s => [s.name, s]));

  // Register each alias as a command
  for (const [alias, target] of resolver.getAll().entries()) {
    registerAliasCommand(program, alias, target, strategyMap);
  }

  Logger.debug(`Registered ${resolver.getAll().size} aliases`);
}

function registerAliasCommand(
  program: Command,
  alias: string,
  target: string,
  strategyMap: Map<string, any>
): void {
  const [strategyName, ...commandParts] = target.split(' ');
  const commandName = commandParts.join(' ');
  const strategy = strategyMap.get(strategyName);

  if (!strategy || !strategy.commands || !strategy.commands[commandName]) {
    // Invalid alias - skip silently (already warned in validation)
    return;
  }

  const cmdDef = strategy.commands[commandName];

  program
    .command(alias)
    .description(`Alias for: ${target}`)
    .option('-p, --path <path>', 'Project path', process.cwd())
    .allowUnknownOption()
    .action(async (options: AliasCommandOptions) => {
      Logger.debug(`Executing alias "${alias}" → "${target}"`);

      const context = new StrategyContextImpl(options.path || process.cwd());

      try {
        const result = await cmdDef.handler(context, options);
        displayResult(target, result);
      } catch (error: any) {
        Logger.error(`Error executing alias "${alias}": ${error.message}`);
        process.exit(1);
      }
    });
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
