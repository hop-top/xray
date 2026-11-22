/**
 * `xray tui [path]` — interactive terminal codebase explorer.
 */
import type { Command } from 'commander';
import { UsageError } from '../lib/error/types';
import { runTuiApp } from '../lib/tui/app';
import { declareEffect } from './side-effect';

export function registerTuiCommand(program: Command): Command {
  const cmd = program
    .command('tui')
    .description('Launch interactive terminal codebase explorer')
    .argument('[path]', 'Root directory to explore', '.')
    .action(async (targetPath: string) => {
      if (!process.stdout.isTTY) {
        throw new UsageError('xray tui requires an interactive TTY (stdout is not a TTY)');
      }
      await runTuiApp(targetPath);
    });

  return declareEffect(cmd, 'interactive', 'no');
}
