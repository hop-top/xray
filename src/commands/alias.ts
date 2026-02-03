import { Command } from 'commander';
import { loadConfig, saveConfig } from '../lib/config';
import { AliasResolver } from '../lib/alias-resolver';
import { Logger } from '../lib/logger';
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
        console.log('No configuration file found.');
        console.log('\nCreate .xrayrc.json to configure aliases.');
        return;
      }

      const resolver = new AliasResolver(config);
      const aliases = resolver.getAll();

      if (aliases.size === 0) {
        console.log('No aliases configured.');
        console.log('\nTo add aliases, use: xray alias set <name> <target>');
        return;
      }

      console.log(chalk.cyan('\nConfigured Aliases:\n'));
      for (const [alias, target] of aliases.entries()) {
        console.log(`  ${chalk.bold(alias)} → ${chalk.gray(target)}`);
      }
      console.log(`\nTotal: ${aliases.size} alias(es)\n`);
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
        Logger.error('Target must be in format "<strategy> <command>"');
        console.log('Example: xray alias set comp "react components"');
        return process.exit(1);
      }

      // Initialize aliases object if needed
      if (!config.aliases) {
        config.aliases = {};
      }

      // Check for built-in conflicts
      const builtIns = ['map', 'scan', 'graph', 'find', 'detect', 'strategies', 'strategy', 'save', 'load', 'alias', 'config'];
      if (builtIns.includes(name)) {
        Logger.error(`Cannot create alias "${name}" - conflicts with built-in command`);
        return process.exit(1);
      }

      // Update config
      const isUpdate = config.aliases[name] !== undefined;
      config.aliases[name] = target;

      // Save config
      saveConfig(config);

      if (isUpdate) {
        console.log(chalk.green(`✓ Updated alias "${name}" → "${target}"`));
      } else {
        console.log(chalk.green(`✓ Created alias "${name}" → "${target}"`));
      }

      console.log('\nRestart xray to use the new alias.');
    });

  // Remove alias
  program
    .command('remove <name>')
    .description('Remove an alias')
    .action(async (name: string) => {
      const config = loadConfig();
      if (!config) {
        Logger.error('No configuration file found');
        return process.exit(1);
      }

      if (!config.aliases || !config.aliases[name]) {
        Logger.error(`Alias "${name}" not found`);
        return process.exit(1);
      }

      const target = config.aliases[name];
      delete config.aliases[name];

      saveConfig(config);

      console.log(chalk.green(`✓ Removed alias "${name}" (was: "${target}")`));
    });

  return program;
}
