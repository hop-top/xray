// src/commands/paths.ts
//
// `xray config path` and `xray config paths` — hop-top §7.4 standard
// configuration introspection subcommands.
//
// Distinct from the `config-files` strategy (which inspects the *user's*
// project config files — see docs/dev/cli-config-noun-decision.md).

import * as fs from 'fs';
import * as path from 'path';
import { terminalSafe } from '../lib/terminal-safe';
import { Command } from 'commander';
import {
  addOutputFlags, assertFormat, columns, emit, outputRegistry, textFormatter,
} from '../lib/output';
import { UsageError } from '../lib/error/types';
import { projectCacheDbPath, projectTelemetryPath } from '../lib/storage';
import { findConfigPath, findGlobalConfigPath } from '../lib/config';
import { bindFlag, staticValues } from './completion';
import { declareEffect } from './side-effect';

// require(): tsconfig moduleResolution 'node' ignores the kit exports map.
const xdg = require('@hop-top/kit/xdg') as Record<
  'configDir' | 'dataDir' | 'cacheDir' | 'stateDir',
  (tool: string) => string
>;

export type ConfigScope = 'flag' | 'project' | 'user';
const VALID_SCOPES: readonly ConfigScope[] = ['flag', 'project', 'user'];

interface PathsOptions {
  format?: string;
  path?: string;
  from?: string;
  /** Root `--config`: reported as the project config (no discovery). */
  config?: string;
}

interface PathsReport {
  projectRoot: string;
  projectConfig: string | null;
  globalConfig: string | null;
  cacheDb: string;
  cacheDbExists: boolean;
  telemetry: string;
  configDir: string;
  dataDir: string;
  cacheDir: string;
  stateDir: string;
}

interface ActiveConfigResult {
  scope: ConfigScope | 'none';
  path: string | null;
  exists: boolean;
}

function collectPaths(projectRoot: string, configPath?: string): PathsReport {
  const cacheDb = projectCacheDbPath(projectRoot) ?? '(unavailable)';
  return {
    projectRoot,
    projectConfig: configPath ? path.resolve(configPath) : findConfigPath(projectRoot),
    globalConfig: findGlobalConfigPath(),
    cacheDb,
    cacheDbExists: fs.existsSync(cacheDb),
    telemetry: projectTelemetryPath(projectRoot) ?? '(unavailable)',
    configDir: xdg.configDir('xray'),
    dataDir: xdg.dataDir('xray'),
    cacheDir: xdg.cacheDir('xray'),
    stateDir: xdg.stateDir('xray'),
  };
}

function resolveActiveConfig(projectRoot: string, configPath?: string): ActiveConfigResult {
  if (configPath) {
    const resolved = path.resolve(configPath);
    return { scope: 'flag', path: resolved, exists: fs.existsSync(resolved) };
  }
  const projectConfig = findConfigPath(projectRoot);
  if (projectConfig) {
    return { scope: 'project', path: projectConfig, exists: fs.existsSync(projectConfig) };
  }
  const globalConfig = findGlobalConfigPath();
  if (globalConfig) {
    return { scope: 'user', path: globalConfig, exists: fs.existsSync(globalConfig) };
  }
  return { scope: 'none', path: null, exists: false };
}

const PATHS_COLUMNS = columns(
  'projectRoot', 'projectConfig', 'globalConfig', 'cacheDb', 'cacheDbExists', 'telemetry',
  'configDir', 'dataDir', 'cacheDir', 'stateDir',
);

const ACTIVE_COLUMNS = columns('scope', 'path', 'exists');

const pathsText = textFormatter<PathsReport | PathsReport[]>('text', (data, put) => {
  const report = Array.isArray(data) ? data[0] : data;
  put(`project-root:    ${terminalSafe(String(report.projectRoot))}`);
  put(`project-config:  ${terminalSafe(report.projectConfig ?? '(none)')}`);
  put(`global-config:   ${terminalSafe(report.globalConfig ?? '(none)')}`);
  put(`cache-db:        ${terminalSafe(String(report.cacheDb))}${report.cacheDbExists ? '' : ' (not yet created)'}`);
  put(`telemetry:       ${terminalSafe(String(report.telemetry))}`);
  put(`config-dir:      ${terminalSafe(String(report.configDir))}`);
  put(`data-dir:        ${terminalSafe(String(report.dataDir))}`);
  put(`cache-dir:       ${terminalSafe(String(report.cacheDir))}`);
  put(`state-dir:       ${terminalSafe(String(report.stateDir))}`);
});

const activePathText = textFormatter<ActiveConfigResult | ActiveConfigResult[]>('text', (data, put) => {
  const item = Array.isArray(data) ? data[0] : data;
  if (item.path) put(terminalSafe(item.path));
});

const pathsRegistry = outputRegistry(pathsText);
const activePathRegistry = outputRegistry(activePathText);

export async function handleConfigPathAction(opts: PathsOptions, cmd: Command): Promise<void> {
  assertFormat(cmd, activePathRegistry);
  const projectRoot = opts.path ? path.resolve(opts.path) : process.cwd();
  const configPath = opts.config ?? (cmd.optsWithGlobals?.().config as string | undefined);
  await emit(cmd, resolveActiveConfig(projectRoot, configPath), {
    registry: activePathRegistry,
    columns: ACTIVE_COLUMNS,
    defaultFormat: 'text',
  });
}

export async function handlePathsAction(opts: PathsOptions, cmd: Command): Promise<void> {
  assertFormat(cmd, pathsRegistry);
  const projectRoot = opts.path ? path.resolve(opts.path) : process.cwd();
  const configPath = opts.config ?? (cmd.optsWithGlobals?.().config as string | undefined);
  if (opts.from !== undefined) {
    const scope = opts.from.toLowerCase() as ConfigScope;
    if (!(VALID_SCOPES as readonly string[]).includes(scope)) {
      throw new UsageError(`invalid --from '${opts.from}' (expected one of: ${VALID_SCOPES.join(', ')})`);
    }
    const target =
      scope === 'flag'
        ? (configPath ? path.resolve(configPath) : null)
        : scope === 'project'
          ? findConfigPath(projectRoot)
          : findGlobalConfigPath();
    await emit(cmd, { scope, path: target, exists: Boolean(target && fs.existsSync(target)) }, {
      registry: activePathRegistry,
      columns: ACTIVE_COLUMNS,
      defaultFormat: 'text',
    });
    return;
  }
  await emit(cmd, collectPaths(projectRoot, configPath), {
    registry: pathsRegistry,
    columns: PATHS_COLUMNS,
    defaultFormat: 'text',
  });
}

export function registerConfigCommand(program: Command): Command {
  const config = program
    .command('config')
    .description("Inspect xray's active configuration and runtime paths");

  const pathCmd = config
    .command('path')
    .description('Show highest-precedence active config file path (one line, pipeable)')
    .option('-p, --path <path>', 'Project path to inspect (default: current directory)');
  addOutputFlags(pathCmd, activePathRegistry, {
    defaultFormat: 'text',
    description: 'Output format: text, json, yaml, table, csv',
  });
  pathCmd.action((opts: PathsOptions, c: Command) => handleConfigPathAction(opts, c));
  declareEffect(pathCmd, 'read', 'yes');

  const pathsCmd = config
    .command('paths')
    .description("Show xray's config files, cache DB, XDG dirs, and project root")
    .option('-p, --path <path>', 'Project path to inspect (default: current directory)')
    .option('--from <scope>', 'Filter to one config scope: flag, project, user');
  addOutputFlags(pathsCmd, pathsRegistry, {
    defaultFormat: 'text',
    description: 'Output format: text, json, yaml, table, csv',
  });
  bindFlag(pathsCmd, 'from', staticValues(...VALID_SCOPES));
  pathsCmd.action((opts: PathsOptions, c: Command) => handlePathsAction(opts, c));
  declareEffect(pathsCmd, 'read', 'yes');

  return config;
}
