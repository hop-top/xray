import { terminalSafe } from '../lib/terminal-safe';
import { Command } from 'commander';
import * as path from 'path';
import { declareEffect, emitPlan, previewing } from './side-effect';
import { assertDataConfig, isWritableConfigFile, loadConfig, saveConfig } from '../lib/config';
import { isAliasTarget, kitAlias, reservedAliasNames, rootCommand, splitAliasTarget, usableAliases } from '../lib/alias-resolver';
import { Logger } from '../lib/logger';
import { hintsEnabled } from './kit-cli';
import { ConflictError, NotFoundError, UsageError, withHelp } from '../lib/error/types';
import { jsonErrorsEnabled } from '../lib/error/report';
import {
  addOutputFlags, assertFormat, columns, emit, outputRegistry, textFormatter,
} from '../lib/output';
import { addResultFormat, assertResultFormat, emitResult } from '../lib/result-format';

interface AliasRow { alias: string; target: string }

const aliasListRegistry = outputRegistry(
  textFormatter<AliasRow[]>('text', (rows, put, s) => {
    if (rows.length === 0) return;
    put(s.accent('\nConfigured Aliases:\n'));
    for (const { alias, target } of rows) {
      put(`  ${s.bold(terminalSafe(alias))} → ${s.muted(terminalSafe(target))}`);
    }
    put(`\nTotal: ${rows.length} alias(es)\n`);
  })
);

/** Root `--config` (propagated onto the running subcommand's opts). */
const rootConfig = (cmd: Command): string | undefined => cmd.opts().config;

/**
 * Config file alias changes write to: the root `--config` file, which
 * must be a JSON config (checked before it loads), else `./.xrayrc.json`.
 */
function aliasWriteTarget(cmd: Command): string | undefined {
  const configPath = rootConfig(cmd);
  if (configPath !== undefined) assertDataConfig(configPath);
  if (configPath !== undefined && !isWritableConfigFile(configPath)) {
    throw new UsageError(`--config ${configPath} is not a JSON config file; alias changes need one`);
  }
  return configPath;
}

/** The config file an alias change reads and writes. */
function configFile(configPath: string | undefined): string {
  return path.resolve(configPath ?? '.xrayrc.json');
}

function saveAliases(config: Parameters<typeof saveConfig>[0], configPath: string | undefined): void {
  if (configPath === undefined) saveConfig(config);
  else saveConfig(config, configPath);
}

/** Next-step hint: dropped by `--no-hints`, `--quiet` and HOP_QUIET_HINTS. */
function hint(cmd: Command, message: string): void {
  const root = rootCommand(cmd);
  const noHints = root.getOptionValueSource('hints') === 'cli';
  if (hintsEnabled({ noHints, quiet: Boolean(root.opts().quiet) })) Logger.info(message);
}

export function registerAliasCommand(): Command {
  const program = new Command('alias')
    .description('Manage command aliases');

  // List aliases
  const listCmd = program
    .command('list')
    .description('List all configured aliases');
  declareEffect(listCmd, 'read', 'yes');
  addOutputFlags(listCmd, aliasListRegistry, {
    defaultFormat: 'text',
    description: 'Output format: text, json, yaml, table, csv',
  }).action(async (_opts: unknown, cmd: Command) => {
    assertFormat(cmd, aliasListRegistry);
    const config = loadConfig(rootConfig(cmd));
    const aliases = config ? usableAliases(config, reservedAliasNames(rootCommand(cmd))) : {};

    if (!config) {
      Logger.info('No configuration file found.');
      hint(cmd, '\nCreate .xrayrc.json to configure aliases.');
    } else if (Object.keys(aliases).length === 0) {
      Logger.info('No aliases configured.');
      hint(cmd, '\nTo add aliases, use: xray alias set <name> <target>');
    }

    const rows: AliasRow[] = Object.entries(aliases).map(([alias, target]) => ({ alias, target }));
    await emit(cmd, rows, {
      registry: aliasListRegistry,
      columns: columns('alias', 'target'),
      defaultFormat: 'text',
    });
  });

  // Set alias
  declareEffect(addResultFormat(program
    .command('set <name> <target>')
    .description('Create or update an alias'))
    .action(async (name: string, target: string, _opts: unknown, cmd: Command) => {
      assertResultFormat(cmd);
      const configPath = aliasWriteTarget(cmd);
      let config = loadConfig(configPath);
      if (!config) {
        // Create default config if none exists
        config = { paths: ['.'] };
      }

      // Validate target format
      if (!isAliasTarget(target)) {
        const example = 'xray alias set comp "react components"';
        if (!jsonErrorsEnabled()) hint(cmd, `Example: ${example}`);
        throw withHelp(new UsageError('Target must be in format "<strategy> <command>"'), { suggestedFix: `Example: ${example}` });
      }

      // Initialize aliases object if needed
      if (!config.aliases) {
        config.aliases = {};
      }

      // Check name: empty, whitespace, built-in conflicts
      try {
        kitAlias.validateAliasName(name, { builtins: reservedAliasNames(rootCommand(cmd)) });
      } catch (err) {
        if (!(err instanceof kitAlias.AliasNameError)) throw err;
        if (err.kind === 'builtin') {
          throw new ConflictError(
            `Cannot create alias "${name}" - conflicts with an existing command; choose another name`
          );
        }
        throw new UsageError(`Invalid alias name "${name}": ${err.message}`);
      }

      // The target must be a registered `<strategy> <command>`: an alias that
      // cannot run is refused here instead of warned about on every run.
      const { strategyName, commandName } = splitAliasTarget(target);
      const strategyCmd = rootCommand(cmd).commands.find((c) => c.name() === strategyName);
      if (!strategyCmd?.commands.some((c) => c.name() === commandName)) {
        throw new NotFoundError(
          strategyCmd
            ? `Unknown command "${commandName}" in strategy "${strategyName}"`
            : `Unknown strategy "${strategyName}"`
        );
      }

      // Update config
      const isUpdate = config.aliases[name] !== undefined;
      if (previewing(cmd)) {
        emitPlan(cmd, [{
          kind: isUpdate ? 'update' : 'create',
          target: `alias:${name}`,
          reversible: !isUpdate,
          detail: `${name} -> ${target} in ${configFile(configPath)}`,
        }]);
        return;
      }
      config.aliases[name] = target;

      // Save config
      saveAliases(config, configPath);

      emitResult(cmd, { alias: name, target, action: isUpdate ? 'updated' : 'created', config: configFile(configPath) }, () => {
        if (isUpdate) {
          Logger.success(`Updated alias "${name}" → "${target}"`);
        } else {
          Logger.success(`Created alias "${name}" → "${target}"`);
        }

        hint(cmd, '\nThe alias is available on the next xray run.');
      });
    }), 'write-local', 'conditional');

  // Remove alias
  declareEffect(addResultFormat(program
    .command('remove <name>')
    .description('Remove an alias'))
    .action(async (name: string, _opts: unknown, cmd: Command) => {
      assertResultFormat(cmd);
      const configPath = aliasWriteTarget(cmd);
      const config = loadConfig(configPath);
      if (!config) {
        throw new NotFoundError('No configuration file found');
      }

      if (!config.aliases || !config.aliases[name]) {
        throw new NotFoundError(`Alias "${name}" not found`);
      }

      const target = config.aliases[name];
      if (previewing(cmd)) {
        emitPlan(cmd, [{
          kind: 'delete',
          target: `alias:${name}`,
          reversible: true,
          detail: `was ${name} -> ${target} in ${configFile(configPath)}`,
        }]);
        return;
      }
      delete config.aliases[name];

      saveAliases(config, configPath);

      emitResult(cmd, { alias: name, target, action: 'removed', config: configFile(configPath) }, () => {
        Logger.success(`Removed alias "${name}" (was: "${target}")`);
      });
    }), 'write-local', 'no');

  return program;
}
