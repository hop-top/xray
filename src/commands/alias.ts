import { Command } from 'commander';
import { loadConfig, saveConfig } from '../lib/config';
import { AliasResolver } from '../lib/alias-resolver';
import { Logger } from '../lib/logger';
import { ConflictError, NotFoundError, UsageError } from '../lib/error/types';
import chalk from 'chalk';

export function registerAliasCommand(): Command {
  const program = new Command('alias')
    .description('Manage command aliases');

  // List aliases
  program
    .command('list')
    .description('List all configured aliases')
    .action(async () => {
      const config = loadConfig();
      if (!config) {
        Logger.info('No configuration file found.');
        Logger.info('\nCreate .xrayrc.json to configure aliases.');
        return;
      }

      const resolver = new AliasResolver(config);
      const aliases = resolver.getAll();

      if (aliases.size === 0) {
        Logger.info('No aliases configured.');
        Logger.info('\nTo add aliases, use: xray alias set <name> <target>');
        return;
      }

      Logger.output(chalk.cyan('\nConfigured Aliases:\n'));
      for (const [alias, target] of aliases.entries()) {
        Logger.output(`  ${chalk.bold(alias)} → ${chalk.gray(target)}`);
      }
      Logger.output(`\nTotal: ${aliases.size} alias(es)\n`);
    });

  // Set alias
  program
    .command('set <name> <target>')
    .description('Create or update an alias')
    .action(async (name: string, target: string) => {
      let config = loadConfig();
      if (!config) {
        // Create default config if none exists
        config = { paths: [process.cwd()] };
      }

      // Validate target format
      if (!target.includes(' ')) {
        Logger.info('Example: xray alias set comp "react components"');
        throw new UsageError('Target must be in format "<strategy> <command>"');
      }

      // Initialize aliases object if needed
      if (!config.aliases) {
        config.aliases = {};
      }

      // Check for built-in conflicts
      const builtIns = ['map', 'scan', 'graph', 'find', 'detect', 'strategies', 'strategy', 'save', 'load', 'alias', 'config', 'lang'];
      if (builtIns.includes(name)) {
        throw new ConflictError(`Cannot create alias "${name}" - conflicts with built-in command`);
      }

      // Update config
      const isUpdate = config.aliases[name] !== undefined;
      config.aliases[name] = target;

      // Save config
      saveConfig(config);

      if (isUpdate) {
        Logger.success(`Updated alias "${name}" → "${target}"`);
      } else {
        Logger.success(`Created alias "${name}" → "${target}"`);
      }

      Logger.info('\nRestart xray to use the new alias.');
    });

  // Remove alias
  program
    .command('remove <name>')
    .description('Remove an alias')
    .action(async (name: string) => {
      const config = loadConfig();
      if (!config) {
        throw new NotFoundError('No configuration file found');
      }

      if (!config.aliases || !config.aliases[name]) {
        throw new NotFoundError(`Alias "${name}" not found`);
      }

      const target = config.aliases[name];
      delete config.aliases[name];

      saveConfig(config);

      Logger.success(`Removed alias "${name}" (was: "${target}")`);
    });

  return program;
}
