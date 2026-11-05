import * as fs from 'fs';
import type { Command } from 'commander';
import { Logger } from '../lib/logger';
import { projectCacheDbPath } from '../lib/storage';
import { emitPlan, previewing } from './side-effect';
import { assertResultFormat, emitResult } from '../lib/result-format';

/** Clears this project's (cwd) cache entry; other projects' entries stay. */
export const handleClearCacheAction = (_opts?: unknown, cmd?: Command) => {
  if (cmd) assertResultFormat(cmd);
  const cachePath = projectCacheDbPath(process.cwd());
  const cacheExists = cachePath !== undefined && fs.existsSync(cachePath);

  if (cmd && previewing(cmd)) {
    emitPlan(cmd, cachePath !== undefined && cacheExists
      ? [{ kind: 'delete', target: cachePath, reversible: true, detail: 'rebuilt on the next analysis' }]
      : []);
    return;
  }

  if (cachePath !== undefined && cacheExists) {
    fs.unlinkSync(cachePath);
    // WAL sidecars, if the db was left in WAL mode.
    for (const ext of ['-wal', '-shm']) fs.rmSync(cachePath + ext, { force: true });
    report(cmd, { cache: cachePath, action: 'cleared' }, () => Logger.success('Cache cleared.'));
  } else {
    report(cmd, { cache: cachePath ?? null, action: 'none' }, () => Logger.warn('No cache found.'));
  }
};

/** Programmatic calls (no command) keep the human lines. */
function report(cmd: Command | undefined, result: unknown, text: () => void): void {
  if (cmd) emitResult(cmd, result, text);
  else text();
}
