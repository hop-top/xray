import type { Command } from 'commander';
import { UsageError } from '../lib/error/types';
import { loadConfig } from '../lib/config';
import { Logger } from '../lib/logger';
import { WorkspaceWatcher } from '../lib/watcher';
import { declareEffect } from './side-effect';
import { confineFor, resolveRunOptions, validateRunRoots } from './generate';

export interface WatchCommandOptions {
  debounce?: string;
  graphOut?: string;
  once?: boolean;
  path?: string[];
  quiet?: boolean;
  config?: string;
}

/** Register `xray watch [paths...]`. */
export function registerWatchCommand(program: Command): Command {
  const cmd = program
    .command('watch')
    .description('Watch workspace files and incrementally update GraphCache')
    .argument('[paths...]', 'Root directories to watch (default: current directory)')
    .option('--debounce <ms>', 'Debounce interval in milliseconds', '150')
    .option('--graph-out <path>', 'Atomically write serialized JSON graph to <path> on startup and after each change')
    .option('--once', 'Warm GraphCache (and write --graph-out if set) once and exit')
    .option('-p, --path <path>', 'Root directory to watch (repeatable)', (v: string, prev: string[]) => prev.concat([v]), [])
    .option('-q, --quiet', 'Suppress watch status logs')
    .action(async (paths: string[], opts: WatchCommandOptions) => {
      const debounceMs = Number(opts.debounce ?? '150');
      if (!Number.isFinite(debounceMs) || debounceMs < 0) {
        throw new UsageError(`invalid --debounce '${opts.debounce}' (expected a non-negative number of milliseconds)`);
      }

      if (paths.length > 0 && (opts.path?.length ?? 0) > 0) {
        throw new UsageError('positional [paths...] cannot be combined with -p/--path');
      }

      const cli = {
        path: paths.length > 0 ? paths : (opts.path ?? []),
        config: opts.config,
        quiet: opts.quiet,
      };
      const config = loadConfig(cli.config, cli.path[0], { resolvePaths: true, confine: confineFor(cli, false) });
      const { mergedOptions } = resolveRunOptions(cli, config);
      validateRunRoots(mergedOptions, opts.config);

      const roots: string[] = mergedOptions.path && mergedOptions.path.length > 0
        ? mergedOptions.path
        : [process.cwd()];

      const watcher = new WorkspaceWatcher({
        roots,
        cwd: process.cwd(),
        debounceMs,
        graphOut: opts.graphOut,
        once: Boolean(opts.once),
        mergedOptions,
        configPath: opts.config,
        onUpdate: (ev) => {
          if (opts.quiet) return;
          if (ev.initial) {
            Logger.info(`xray watch: warmed ${roots.length} root(s) in ${ev.durationMs}ms`);
          } else {
            Logger.info(`xray watch: patched ${ev.changedFiles.length} changed, ${ev.removedFiles.length} removed in ${ev.durationMs}ms`);
          }
        },
        onError: (err) => {
          Logger.error(`xray watch error: ${err.message}`);
        },
      });

      if (opts.once) {
        await watcher.start();
        return;
      }

      await new Promise<void>((resolve, reject) => {
        let shuttingDown = false;
        const shutdown = async () => {
          if (shuttingDown) return;
          shuttingDown = true;
          process.removeListener('SIGINT', shutdown);
          process.removeListener('SIGTERM', shutdown);
          try {
            await watcher.stop();
          } finally {
            resolve();
          }
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        watcher.start().then(
          () => {
            if (shuttingDown) {
              void watcher.stop().finally(resolve);
            }
          },
          (err) => {
            process.removeListener('SIGINT', shutdown);
            process.removeListener('SIGTERM', shutdown);
            reject(err);
          },
        );
      });
    });

  return declareEffect(cmd, 'interactive', 'no');
}
