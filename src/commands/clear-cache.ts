import * as fs from 'fs';
import { Logger } from '../lib/logger';
import { projectCacheDbPath } from '../lib/storage';

/** Clears this project's (cwd) cache entry; other projects' entries stay. */
export const handleClearCacheAction = () => {
  const cachePath = projectCacheDbPath(process.cwd());
  const cacheExists = cachePath !== undefined && fs.existsSync(cachePath);

  if (cachePath !== undefined && cacheExists) {
    fs.unlinkSync(cachePath);
    // WAL sidecars, if the db was left in WAL mode.
    for (const ext of ['-wal', '-shm']) fs.rmSync(cachePath + ext, { force: true });
    Logger.success('Cache cleared.');
  } else {
    Logger.warn('No cache found.');
  }
};
