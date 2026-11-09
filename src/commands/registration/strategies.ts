// src/commands/registration/strategies.ts
import * as fs from 'fs';
import { terminalSafe, terminalSafeBlock } from '../../lib/terminal-safe';
import { Command } from 'commander';
import { CodeLoadingOptions, StrategyLoader, reportSkippedProjectCode } from '../../lib/strategy/loader';
import { StrategyContextImpl } from '../../lib/strategy/context';
import {
  Extension,
  ExtensionCommandOption,
  Strategy,
  StrategyCommand,
  normalizeDetectedStrategy,
} from '../../lib/strategy/types';
import { Logger } from '../../lib/logger';
import { jsonErrorsEnabled, toCliError, writeEnvelope } from '../../lib/error/report';
import { StrategyCacheManager } from './cache';
import { StrategyCommandOptions } from '../../types/command-options';
import {
  addExtensionOverrideOptions,
  createStrategyContext,
  normalizeExtensionOptions,
} from '../common';
import { CodedError, EXIT_NOT_FOUND, NotFoundError, UsageError } from '../../lib/error/types';
import { setCommandGroup } from '../kit-cli';
import { declareEffect, declareExitCodes, emitPlan, markOmittedFromDescribe, previewing } from '../side-effect';
import type { Effect } from '../kit-cli';
import { RENAMED_STRATEGIES } from '../../lib/strategy/renamed';
import {
  OUTPUT_FLAG_NAMES, addOutputFlags, assertFormat, emit, outputRegistry, textFormatter,
  unionColumns,
} from '../../lib/output';

/**
 * Register dynamic strategy commands
 * Discovers all available strategies and registers their commands
 */
export async function registerStrategyCommands(
  program: Command,
  options: CodeLoadingOptions = {}
): Promise<void> {
  return registerExtensionCommands(program, options);
}

export async function registerExtensionCommands(
  program: Command,
  options: CodeLoadingOptions = {}
): Promise<void> {
  const loader = new StrategyLoader(options);
  const projectCode = options.projectCode ?? true;
  const cacheManager = new StrategyCacheManager();

  // Every command passes here: quiet unless debugging. Commands that are
  // about strategies, or name one, say it at warn level themselves.
  reportSkippedProjectCode('debug', options);

  try {
    // Try to use cached strategies first. The cache lives in the user cache
    // dir; without project code it is neither read nor written.
    const cached = projectCode ? await cacheManager.getCached() : null;
    let strategies: Strategy[];

    if (!projectCode) {
      strategies = await loader.discoverStrategies();
    } else if (cached) {
      Logger.debug('Found valid strategy cache metadata');
      strategies = await loader.discoverStrategies();

      // Validate that loaded strategies match cache
      if (!cacheManager.validateCache(strategies, cached)) {
        Logger.debug('Cache validation failed, reloading strategies');
        strategies = await loader.discoverStrategies();
        await cacheManager.save(strategies);
      }
    } else {
      // No cache or invalid cache - load fresh
      Logger.debug('Loading strategies from disk');
      strategies = await loader.discoverStrategies();
      await cacheManager.save(strategies);
    }

    const extensions = await loader.discoverExtensions(strategies);

    // Register each extension as a command group
    for (const extension of extensions) {
      try {
        registerStrategyCommand(program, extension);
        const old = RENAMED_STRATEGIES[extension.name];
        if (old !== undefined && !program.commands.some((c) => c.name() === old)) {
          registerStrategyCommand(program, extension, old);
        }
      } catch (error: any) {
        Logger.warn(`Failed to register extension "${extension.name}": ${error.message}`);
      }
    }

    Logger.debug(`Registered ${extensions.length} extensions with dynamic commands`);
  } catch (error: any) {
    // Strategy discovery failed - continue with static commands only
    handleStrategyDiscoveryError(error);
  }
}

/**
 * Handle strategy discovery errors gracefully
 */
function handleStrategyDiscoveryError(error: any): void {
  if (error.code === 'ENOENT') {
    Logger.debug('Strategy directory not found - no custom strategies available');
  } else if (error.code === 'EACCES') {
    Logger.warn('Permission denied reading strategies - continuing with built-in commands');
  } else if (error.message?.includes('Cannot find module')) {
    Logger.debug(`Strategy module loading failed: ${error.message}`);
  } else {
    Logger.warn(`Strategy discovery failed: ${error.message}`);
  }

  Logger.debug('Continuing with built-in commands only');
}

/**
 * Register a single extension and its commands. `hiddenAs` registers the
 * same commands under that (old) name, hidden.
 */
function registerStrategyCommand(
  program: Command,
  extension: Strategy | Extension,
  hiddenAs?: string
): void {
  if (!extension.commands || Object.keys(extension.commands).length === 0) {
    Logger.debug(`Extension "${extension.name}" has no commands, skipping`);
    return;
  }

  const strategyCmd = program
    .command(hiddenAs ?? extension.name, hiddenAs === undefined ? undefined : { hidden: true })
    .description(extension.description ?? `${extension.name} commands`);
  // The hidden alias gets no group: MCP tools and help sections follow it.
  if (hiddenAs === undefined) setCommandGroup(strategyCmd, 'strategy');
  else markOmittedFromDescribe(strategyCmd);

  for (const [cmdName, cmdDef] of Object.entries(
    extension.commands as Record<string, StrategyCommand>
  )) {
    if (!cmdDef.handler || typeof cmdDef.handler !== 'function') {
      Logger.warn(
        `Extension "${extension.name}" has invalid command "${cmdName}" ` +
          '(missing or invalid handler)'
      );
      continue;
    }

    // Strategy commands are reads unless they declare otherwise
    // (`StrategyCommand.effect`): they analyze the project and return a
    // result xray prints, and never run repo code in the read tier. A
    // command that runs code or changes anything declares its tier, and kit
    // then gates it (confirmation, --dry-run); MCP exposes reads only.
    const effect = cmdDef.effect ?? { tier: 'read', idempotent: 'yes' };
    const cmdBase = strategyCmd
      .command(cmdName)
      .description(cmdDef.description || `Execute ${cmdName} command`);
    if (cmdDef.positional) cmdBase.argument(`<${cmdDef.positional.name}>`, cmdDef.positional.description);
    const cmd = declareEffect(addExtensionOverrideOptions(
      cmdBase.option('-p, --path <path>', 'Project path to analyze (default: current directory)')
    ), effect.tier, effect.idempotent);
    // A --path that is not a directory is not found (see executeStrategyCommand).
    declareExitCodes(cmd, [EXIT_NOT_FOUND]);

    if (cmdDef.options) {
      for (const [optName, optDef] of Object.entries(cmdDef.options)) {
        const { flags, description, fn } = toCommanderOption(optName, optDef);
        const defaultValue =
          typeof optDef === 'object' && optDef.repeatable ? [] : undefined;

        if (fn) {
          cmd.option(flags, description, fn, defaultValue);
        } else {
          cmd.option(flags, description, defaultValue as any);
        }
      }
    }

    // Commands that declare their own output flag (e.g. `--format`) keep
    // their semantics; every other command gets the kit output suite.
    const registry = ownsOutputFlag(cmdDef)
      ? undefined
      : outputRegistry(strategyTextFormatter(extension.name, cmdName), DOT_FORMATTER);
    if (registry) {
      addOutputFlags(cmd, registry, {
        defaultFormat: 'text',
        description: 'Output format: text, json, yaml, table, csv; dot for graph commands',
      });
    }

    // Intentionally NOT allowUnknownOption(): unknown flags must surface
    // as commander parse errors → UsageError (exit 2) so typos like
    // `--extenson-threshold` fail loudly instead of being silently
    // swallowed and bypassing the rest of the validation chain.
    cmd.action(async (...actionArgs: unknown[]) => {
      // commander: (...positionals, options, command)
      const command = actionArgs[actionArgs.length - 1] as Command;
      const options = actionArgs[actionArgs.length - 2] as StrategyCommandOptions;
      if (registry) assertFormat(command, registry);
      const normalizedOptions: Record<string, unknown> = normalizeExtensionOptions(
        registry ? withoutOutputFlags(options, command) : options
      ) as Record<string, unknown>;
      if (cmdDef.positional) normalizedOptions[cmdDef.positional.name] = actionArgs[0];
      // Kit skips confirmation under a root --dry-run for a non-read tier;
      // the handler then resolves what it would do and returns it as
      // `{ effects }` instead of acting.
      const preview = effect.tier !== 'read' && previewing(command);
      if (preview) normalizedOptions.dryRun = true;
      const result = await executeStrategyCommand(
        extension,
        cmdName,
        cmdDef,
        normalizedOptions
      );
      // A non-read handler may stream its own output and return nothing.
      if (result === undefined && effect.tier !== 'read' && !preview) return;
      if (preview) {
        emitPlan(command, (result as { effects?: Effect[] } | undefined)?.effects ?? []);
        return;
      }
      if (registry) {
        await emit(command, result ?? null, {
          registry,
          columns: unionColumns(result),
          defaultFormat: 'text',
        });
      } else {
        writeStrategyResult(extension.name, cmdName, result, process.stdout);
      }
    });
  }
}

/** Option keys the kit output suite adds to a command. */
const OUTPUT_OPTION_KEYS = new Set([
  'format', 'formatOpt', 'formatHelp', 'cols', 'columns', 'template', 'output',
]);

/** Whether a strategy command declares an option the kit suite would add. */
function ownsOutputFlag(cmdDef: StrategyCommand): boolean {
  return Object.entries(cmdDef.options ?? {}).some(([name, def]) =>
    (OUTPUT_FLAG_NAMES as readonly string[]).includes(name) ||
    (typeof def === 'object' && def.alias === 'o')
  );
}

/**
 * Strip kit output flags so handlers see only their own options. An
 * explicit `--format` stays visible: graph handlers pre-render `dot`.
 */
function withoutOutputFlags(options: StrategyCommandOptions, cmd: Command): StrategyCommandOptions {
  const explicitFormat = cmd.getOptionValueSource('format') === 'cli';
  return Object.fromEntries(
    Object.entries(options).filter(
      ([k]) => !OUTPUT_OPTION_KEYS.has(k) || (k === 'format' && explicitFormat)
    )
  ) as StrategyCommandOptions;
}

/**
 * `dot`: graph handlers asked for `--format dot` return a pre-rendered
 * `{ format: 'dot', content }` document; anything else cannot be drawn.
 */
const DOT_FORMATTER = textFormatter<unknown>('dot', (result, put) => {
  const doc = result as { format?: unknown; content?: unknown } | null;
  if (!doc || doc.format !== 'dot' || typeof doc.content !== 'string') {
    throw new Error('format "dot" is only supported by graph commands');
  }
  put(terminalSafeBlock(doc.content));
});

const isDirectory = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Execute an extension command
 */
async function executeStrategyCommand(
  extension: Strategy | Extension,
  cmdName: string,
  cmdDef: StrategyCommand,
  options: StrategyCommandOptions
): Promise<unknown> {
  const projectPath = options.path || process.cwd();
  // An absent root is a typo, not an empty project: fail like `map` does.
  if (!isDirectory(projectPath)) {
    throw new NotFoundError(`Path does not exist or is not a directory: ${projectPath}`);
  }
  const detectionSource =
    'strategy' in extension && extension.strategy
      ? extension.strategy
      : extension;

  try {
    const context = createStrategyContext(projectPath, options);
    Logger.info(`Executing ${extension.name}:${cmdName}...`);

    const detected = normalizeDetectedStrategy(
      detectionSource,
      await extension.detect(context)
    );
    if (!detected) {
      Logger.warn(
        `Extension "${extension.name}" did not detect an applicable project ` +
          `at ${projectPath}`
      );
    }

    await analyzeProjectFiles(extension, context);

    return await cmdDef.handler(context, options);
  } catch (error: any) {
    return await handleStrategyCommandError(error, extension.name, cmdName, projectPath);
  }
}

function toCommanderOption(
  optionName: string,
  optionValue: ExtensionCommandOption
): {
  flags: string;
  description: string;
  fn?: (value: string, previous: any) => any;
} {
  if (typeof optionValue === 'string') {
    const placeholder = optionName.includes('show-') ? '' : ` <${optionName}>`;
    return {
      flags: `--${optionName}${placeholder}`.trim(),
      description: optionValue,
    };
  }

  const aliasPrefix = optionValue.alias ? `-${optionValue.alias}, ` : '';
  const placeholder =
    optionValue.type === 'boolean'
      ? ''
      : ` ${optionValue.placeholder || `<${optionName}>`}`;

  const flagLabel = `--${optionName}`;
  const parseNumber = (raw: string): number => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new UsageError(
        `Invalid ${flagLabel} value "${raw}". Expected a number.`
      );
    }
    return parsed;
  };

  let fn: ((value: string, previous: any) => any) | undefined;

  if (optionValue.repeatable) {
    if (optionValue.type === 'number') {
      fn = (val, prev) => (prev || []).concat([parseNumber(val)]);
    } else {
      fn = (val, prev) => (prev || []).concat([val]);
    }
  } else if (optionValue.type === 'number') {
    fn = (val) => parseNumber(val);
  }

  return {
    flags: `${aliasPrefix}--${optionName}${placeholder}`,
    description: optionValue.description,
    fn,
  };
}

/**
 * Analyze all relevant project files for an extension, populating tags and
 * metadata in context
 */
async function analyzeProjectFiles(
  strategy: Strategy | Extension,
  context: StrategyContextImpl
): Promise<void> {
  if (typeof strategy.analyze !== 'function') {
    return;
  }

  const { globSync } = await import('glob');
  const { isSafeEntry } = await import('../../lib/safe-read');
  const path = await import('path');

  const fileTypes = strategy.fileTypes?.() || [];
  const ignorePatterns = strategy.ignorePatterns?.() || ['**/node_modules/**', '**/.git/**'];
  const projectRoot = context.getProjectRoot();

  // Build glob patterns from file types
  let patterns: string[];
  if (fileTypes.length > 0) {
    patterns = fileTypes.map(ext => `**/*${ext}`);
  } else {
    patterns = ['**/*'];
  }

  // Collect all matching files using glob with ignore support
  const seen = new Set<string>();
  for (const pattern of patterns) {
    const files = globSync(pattern, {
      cwd: projectRoot,
      nodir: true,
      ignore: ignorePatterns
    });
    // Regular files inside the root only: not a FIFO or device, not a link out.
    for (const file of files) {
      if (isSafeEntry(projectRoot, file)) seen.add(file);
    }
  }

  // Analyze each file and populate context
  for (const file of seen) {
    const fullPath = path.join(projectRoot, file);
    try {
      const metadata = await strategy.analyze(fullPath, context);

      // Store tags in context
      for (const tag of metadata.tags) {
        context.addFileTag(file, tag);
      }

      // Store metadata in context
      if (metadata.metadata && Object.keys(metadata.metadata).length > 0) {
        context.setFileMetadata(file, strategy.name, metadata.metadata);
      }
    } catch (error: any) {
      Logger.debug(`Failed to analyze ${file}: ${error.message}`);
    }
  }
}

/**
 * Handle strategy command execution errors with helpful messages
 */
async function handleStrategyCommandError(
  error: any,
  strategyName: string,
  cmdName: string,
  projectPath: string
): Promise<never> {
  // A coded failure (not found, usage, ...) keeps its exit code.
  if (error instanceof CodedError) throw error;
  if (jsonErrorsEnabled()) {
    writeEnvelope(toCliError(error));
    process.exit(1);
  }

  const { LogLevel } = await import('../../lib/logger');

  // Categorize and provide helpful error messages
  if (error.code === 'ENOENT') {
    Logger.error(`Project path not found: ${projectPath}`);
    Logger.info('');
    Logger.info('Tip: Use the -p option to specify a valid project directory');
    Logger.info(`Example: xray ${strategyName} ${cmdName} -p /path/to/project`);
  } else if (error.code === 'EACCES') {
    Logger.error(`Permission denied accessing: ${error.path || projectPath}`);
    Logger.info('');
    Logger.info('Tip: Check file permissions or run with appropriate privileges');
  } else if (error.message?.includes('package.json')) {
    Logger.error(`Failed to read package.json in: ${projectPath}`);
    Logger.info('');
    Logger.info('Tip: Ensure you\'re running this command in a valid project directory');
    Logger.info(`Current path: ${projectPath}`);
  } else if (error.message?.includes('not found') || error.message?.includes('Cannot find')) {
    Logger.error(`Resource not found: ${error.message}`);
    Logger.info('');
    Logger.info(`Command: xray ${strategyName} ${cmdName}`);
    Logger.info(`Path: ${projectPath}`);
  } else {
    // Generic error with helpful context
    Logger.error(`Error executing ${strategyName}:${cmdName}: ${error.message}`);
    Logger.info('');
    Logger.info(`Project: ${projectPath}`);

    if (error.cause) {
      Logger.info(`Cause: ${error.cause}`);
    }
  }

  // Show stack trace in debug mode
  if (Logger.getLevel() === LogLevel.DEBUG) {
    Logger.debug('Stack trace:');
    Logger.debug(error.stack);
  } else {
    Logger.info('');
    Logger.info('Run with -v debug for detailed error information');
  }

  process.exit(1);
}

/**
 * Human (`text`) view of a strategy command result: titled list for arrays,
 * pretty JSON for objects, raw value otherwise.
 */
function strategyTextFormatter(strategyName: string, cmdName: string) {
  return textFormatter<unknown>('text', (result, put) => {
    renderStrategyResult(strategyName, cmdName, result, put);
  });
}

function writeStrategyResult(
  strategyName: string, cmdName: string, result: unknown, out: NodeJS.WritableStream
): void {
  renderStrategyResult(strategyName, cmdName, result, (line = '') => {
    out.write(line + '\n');
  });
}

function renderStrategyResult(
  strategyName: string, cmdName: string, result: any, put: (line?: string) => void
): void {
  const title = formatTitle(strategyName, cmdName);

  // Everything below can come from repo files (headings, targets, paths).
  if (Array.isArray(result)) {
    put(`\n${title}:\n`);

    if (result.length === 0) {
      put('  (none found)');
    } else {
      result.forEach((item: any) => {
        if (typeof item === 'object') {
          const name = item.name || item.title || item.id || JSON.stringify(item);
          put(`  ${terminalSafe(String(name))}`);

          if (item.file) {
            put(`    → ${terminalSafe(String(item.file))}${item.line ? `:${terminalSafe(String(item.line))}` : ''}`);
          }

          if (item.description) {
            put(`    ${terminalSafe(String(item.description))}`);
          }
        } else {
          put(`  ${terminalSafe(String(item))}`);
        }
      });
    }

    put(`\nTotal: ${result.length}\n`);
  } else if (typeof result === 'object' && result !== null) {
    put(terminalSafeBlock(JSON.stringify(result, null, 2)));
  } else if (result !== undefined && result !== null) {
    put(terminalSafeBlock(String(result)));
  }
}

/**
 * Format command title for display
 */
function formatTitle(strategyName: string, cmdName: string): string {
  const title = `${strategyName} ${cmdName}`;
  return title.charAt(0).toUpperCase() + title.slice(1);
}
