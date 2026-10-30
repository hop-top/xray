import { Command } from 'commander';
import { loadConfig, saveConfig } from '../lib/config';
import { isAliasTarget, kitAlias, usableAliases } from '../lib/alias-resolver';
import { Logger } from '../lib/logger';
import { ConflictError, NotFoundError, UsageError } from '../lib/error/types';
import {
  addOutputFlags, assertFormat, columns, emit, outputRegistry, textFormatter,
} from '../lib/output';

interface AliasRow { alias: string; target: string }

/** Names `alias set` refuses. */
const SET_BUILTINS = [
  'map', 'scan', 'graph', 'find', 'detect', 'strategies', 'strategy', 'save', 'load', 'alias', 'config', 'lang',
];

const aliasListRegistry = outputRegistry(
  textFormatter<AliasRow[]>('text', (rows, put, s) => {
    if (rows.length === 0) return;
    put(s.accent('\nConfigured Aliases:\n'));
    for (const { alias, target } of rows) {
      put(`  ${s.bold(alias)} → ${s.muted(target)}`);
    }
    put(`\nTotal: ${rows.length} alias(es)\n`);
  })
);

export function registerAliasCommand(): Command {
  const program = new Command('alias')
    .description('Manage command aliases');

  // List aliases
  const listCmd = program
    .command('list')
    .description('List all configured aliases');
  addOutputFlags(listCmd, aliasListRegistry, {
    defaultFormat: 'text',
    description: 'Output format: text, json, yaml, table, csv',
  }).action(async (_opts: unknown, cmd: Command) => {
    assertFormat(cmd, aliasListRegistry);
    const config = loadConfig();
    const aliases = config ? usableAliases(config) : {};

    if (!config) {
      Logger.info('No configuration file found.');
      Logger.info('\nCreate .xrayrc.json to configure aliases.');
    } else if (Object.keys(aliases).length === 0) {
      Logger.info('No aliases configured.');
      Logger.info('\nTo add aliases, use: xray alias set <name> <target>');
    }

    const rows: AliasRow[] = Object.entries(aliases).map(([alias, target]) => ({ alias, target }));
    await emit(cmd, rows, {
      registry: aliasListRegistry,
      columns: columns('alias', 'target'),
      defaultFormat: 'text',
    });
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
      if (!isAliasTarget(target)) {
        Logger.info('Example: xray alias set comp "react components"');
        throw new UsageError('Target must be in format "<strategy> <command>"');
      }

      // Initialize aliases object if needed
      if (!config.aliases) {
        config.aliases = {};
      }

      // Check name: empty, whitespace, built-in conflicts
      try {
        kitAlias.validateAliasName(name, { builtins: SET_BUILTINS });
      } catch (err) {
        if (!(err instanceof kitAlias.AliasNameError)) throw err;
        if (err.kind === 'builtin') {
          throw new ConflictError(`Cannot create alias "${name}" - conflicts with built-in command`);
        }
        throw new UsageError(`Invalid alias name "${name}": ${err.message}`);
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
