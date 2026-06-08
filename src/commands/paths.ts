// src/commands/paths.ts
//
// Introspect xray's own runtime paths: which config file xray is reading,
// where it caches its SQLite analysis DB, and what it considers the project
// root. Distinct from the `config` strategy (which inspects the *user's*
// project config files — see docs/dev/cli-config-noun-decision.md).

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { Logger } from '../lib/logger';
import { findConfigPath, findGlobalConfigPath } from '../lib/config';

interface PathsOptions {
  format?: 'text' | 'json';
  path?: string;
}

interface PathsReport {
  projectRoot: string;
  projectConfig: string | null;
  globalConfig: string | null;
  cacheDb: string;
  cacheDbExists: boolean;
}

function collectPaths(projectRoot: string): PathsReport {
  const cacheDb = path.join(projectRoot, '.xray_cache.db');
  return {
    projectRoot,
    projectConfig: findConfigPath(projectRoot),
    globalConfig: findGlobalConfigPath(),
    cacheDb,
    cacheDbExists: fs.existsSync(cacheDb),
  };
}

function emit(report: PathsReport, format: 'text' | 'json'): void {
  if (format === 'json') {
    Logger.output(JSON.stringify(report, null, 2));
    return;
  }
  Logger.output(`project-root:    ${report.projectRoot}`);
  Logger.output(`project-config:  ${report.projectConfig ?? '(none)'}`);
  Logger.output(`global-config:   ${report.globalConfig ?? '(none)'}`);
  Logger.output(
    `cache-db:        ${report.cacheDb}${report.cacheDbExists ? '' : ' (not yet created)'}`
  );
}

export function handlePathsAction(opts: PathsOptions = {}): void {
  const projectRoot = opts.path
    ? path.resolve(opts.path)
    : process.cwd();
  const format: 'text' | 'json' = opts.format === 'json' ? 'json' : 'text';
  emit(collectPaths(projectRoot), format);
}

export function registerPathsCommand(program: Command): void {
  program
    .command('paths')
    .description("Show xray's active config, cache DB, and project root")
    .option('-p, --path <path>', 'Project path to inspect', process.cwd())
    .option('--format <format>', 'Output format: text or json', 'text')
    .action((opts: PathsOptions) => handlePathsAction(opts));
}
