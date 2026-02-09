import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../lib/logger';

export const handleClearCacheAction = () => {
  const cachePath = path.join(process.cwd(), '.xray_cache.db');
  const cacheExists = fs.existsSync(cachePath);

  if (cacheExists) {
    fs.unlinkSync(cachePath);
    Logger.success('Cache cleared.');
  } else {
    Logger.warn('No cache found.');
  }
};
