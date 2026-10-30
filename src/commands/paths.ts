// src/commands/paths.ts
//
// Introspect xray's own runtime paths: which config file xray is reading,
// where it caches its SQLite analysis DB, and what it considers the project
// root. Distinct from the `config` strategy (which inspects the *user's*
// project config files — see docs/dev/cli-config-noun-decision.md).

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import {
  addOutputFlags, assertFormat, columns, emit, outputRegistry, textFormatter,
} from '../lib/output';
import { findConfigPath, findGlobalConfigPath } from '../lib/config';

// require(): tsconfig moduleResolution 'node' ignores the kit exports map.
const xdg = require('@hop-top/kit/xdg') as Record<
  'configDir' | 'dataDir' | 'cacheDir' | 'stateDir',
  (tool: string) => string
>;

interface PathsOptions {
  format?: string;
  path?: string;
  /** Root `--config`: reported as the project config (no discovery). */
  config?: string;
}

interface PathsReport {
  projectRoot: string;
  projectConfig: string | null;
  globalConfig: string | null;
  cacheDb: string;
  cacheDbExists: boolean;
  configDir: string;
  dataDir: string;
  cacheDir: string;
  stateDir: string;
}

function collectPaths(projectRoot: string, configPath?: string): PathsReport {
  const cacheDb = path.join(projectRoot, '.xray_cache.db');
  return {
    projectRoot,
    projectConfig: configPath ? path.resolve(configPath) : findConfigPath(projectRoot),
    globalConfig: findGlobalConfigPath(),
    cacheDb,
    cacheDbExists: fs.existsSync(cacheDb),
    configDir: xdg.configDir('xray'),
    dataDir: xdg.dataDir('xray'),
    cacheDir: xdg.cacheDir('xray'),
    stateDir: xdg.stateDir('xray'),
  };
}

const PATHS_COLUMNS = columns(
  'projectRoot', 'projectConfig', 'globalConfig', 'cacheDb', 'cacheDbExists',
  'configDir', 'dataDir', 'cacheDir', 'stateDir',
);

const pathsText = textFormatter<PathsReport | PathsReport[]>('text', (data, put) => {
  const report = Array.isArray(data) ? data[0] : data;
  put(`project-root:    ${report.projectRoot}`);
  put(`project-config:  ${report.projectConfig ?? '(none)'}`);
  put(`global-config:   ${report.globalConfig ?? '(none)'}`);
  put(`cache-db:        ${report.cacheDb}${report.cacheDbExists ? '' : ' (not yet created)'}`);
  put(`config-dir:      ${report.configDir}`);
  put(`data-dir:        ${report.dataDir}`);
  put(`cache-dir:       ${report.cacheDir}`);
  put(`state-dir:       ${report.stateDir}`);
});

const registry = outputRegistry(pathsText);

export async function handlePathsAction(opts: PathsOptions, cmd: Command): Promise<void> {
  assertFormat(cmd, registry);
  const projectRoot = opts.path ? path.resolve(opts.path) : process.cwd();
  await emit(cmd, collectPaths(projectRoot, opts.config), {
    registry,
    columns: PATHS_COLUMNS,
    defaultFormat: 'text',
  });
}

export function registerPathsCommand(program: Command): void {
  const cmd = program
    .command('paths')
    .description("Show xray's active config, cache DB, and project root")
    .option('-p, --path <path>', 'Project path to inspect', process.cwd());
  addOutputFlags(cmd, registry, {
    defaultFormat: 'text',
    description: 'Output format: text, json, yaml, table, csv',
  });
  cmd.action((opts: PathsOptions, c: Command) => handlePathsAction(opts, c));
}
