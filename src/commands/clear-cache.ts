import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../lib/logger';
import { getTelemetryTracker } from '../lib/telemetry';

export const handleClearCacheAction = () => {
  const telemetry = getTelemetryTracker();

  try {
    const cachePath = path.join(process.cwd(), '.xray_cache.db');
    const cacheExists = fs.existsSync(cachePath);

    if (telemetry) {
      telemetry.trackCommand('clear-cache', { cacheExists });
    }

    if (cacheExists) {
      const stats = fs.statSync(cachePath);
      fs.unlinkSync(cachePath);
      Logger.success('Cache cleared.');

      if (telemetry) {
        telemetry.trackStat('cache.size', stats.size, { unit: 'bytes', command: 'clear-cache' });
      }
    } else {
      Logger.warn('No cache found.');
    }
  } catch (error) {
    if (telemetry) {
      telemetry.trackError('ClearCacheError', error instanceof Error ? error : new Error(String(error)));
    }
    throw error;
  }
};