// src/commands/registration/cache.ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Strategy } from '../../lib/strategy/types';
import { Logger } from '../../lib/logger';
import { ensurePrivateDir, projectKey } from '../../lib/storage';

// require(): tsconfig moduleResolution 'node' ignores the kit exports map.
const { cacheDir: xdgCacheDir } = require('@hop-top/kit/xdg') as {
  cacheDir: (tool: string) => string;
};

const { version: XRAY_VERSION } = require('../../../package.json');

export interface CachedStrategy {
  name: string;
  version: string;
  commands?: Record<string, { description: string }>;
  hash: string;
}

export interface StrategyCache {
  version: string;
  timestamp: number;
  strategies: CachedStrategy[];
}

/** Read a file without following a final symlink (where the platform can). */
async function readNoFollow(file: string): Promise<string> {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const fh = await fs.promises.open(file, flags);
  try {
    return await fh.readFile('utf-8');
  } finally {
    await fh.close();
  }
}

export class StrategyCacheManager {
  private cacheDir: string;
  readonly cacheFile: string;

  /**
   * The cache lives in the user cache dir, keyed by project root, never in
   * the project: read-only commands must not write into the cwd.
   */
  constructor(projectRoot: string = process.cwd()) {
    this.cacheDir = path.join(xdgCacheDir('xray'), 'strategies', projectKey(projectRoot));
    this.cacheFile = path.join(this.cacheDir, 'strategy-cache.json');
  }

  /**
   * Get cached strategies if valid
   * Returns null if cache is invalid or doesn't exist
   */
  async getCached(): Promise<CachedStrategy[] | null> {
    try {
      // A shared XDG dir may hold planted links: read only from a private dir.
      if (!ensurePrivateDir(this.cacheDir)) {
        Logger.debug('Strategy cache dir is not private; ignoring cache');
        return null;
      }
      if (!fs.existsSync(this.cacheFile)) {
        Logger.debug('Strategy cache not found');
        return null;
      }

      const content = await readNoFollow(this.cacheFile);
      const cache: StrategyCache = JSON.parse(content);

      // Validate cache version
      if (cache.version !== XRAY_VERSION) {
        Logger.debug(`Cache version mismatch: ${cache.version} !== ${XRAY_VERSION}`);
        return null;
      }

      // Check if cache is stale (older than 24 hours)
      const age = Date.now() - cache.timestamp;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      if (age > maxAge) {
        Logger.debug(`Cache is stale (${Math.round(age / 1000 / 60)} minutes old)`);
        return null;
      }

      Logger.debug(`Loaded ${cache.strategies.length} strategies from cache`);
      return cache.strategies;
    } catch (error: any) {
      Logger.debug(`Failed to load cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Save strategies to cache
   */
  async save(strategies: Strategy[]): Promise<void> {
    try {
      // Private dir or no cache: never write through a planted link.
      if (!ensurePrivateDir(this.cacheDir)) {
        Logger.debug('Strategy cache dir is not private; not caching');
        return;
      }

      const cached: CachedStrategy[] = strategies.map(strategy => ({
        name: strategy.name,
        version: strategy.version,
        commands: strategy.commands
          ? Object.fromEntries(
              Object.entries(strategy.commands).map(([name, cmd]) => [
                name,
                { description: cmd.description }
              ])
            )
          : undefined,
        hash: this.hashStrategy(strategy)
      }));

      const cache: StrategyCache = {
        version: XRAY_VERSION,
        timestamp: Date.now(),
        strategies: cached
      };

      // Fresh file + rename: replaces a stale entry (even a link) instead of
      // writing through it.
      const tmp = `${this.cacheFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
      await fs.promises.writeFile(tmp, JSON.stringify(cache, null, 2), { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
      await fs.promises.rename(tmp, this.cacheFile);

      Logger.debug(`Cached ${cached.length} strategies`);
    } catch (error: any) {
      Logger.warn(`Failed to save strategy cache: ${error.message}`);
    }
  }

  /**
   * Clear the cache
   */
  async clear(): Promise<void> {
    try {
      if (fs.existsSync(this.cacheFile)) {
        await fs.promises.unlink(this.cacheFile);
        Logger.debug('Strategy cache cleared');
      }
    } catch (error: any) {
      Logger.warn(`Failed to clear cache: ${error.message}`);
    }
  }

  /**
   * Generate hash for strategy to detect changes
   * Based on strategy name, version, and command definitions
   */
  private hashStrategy(strategy: Strategy): string {
    const data = {
      name: strategy.name,
      version: strategy.version,
      commands: strategy.commands
        ? Object.keys(strategy.commands).sort()
        : []
    };

    return crypto
      .createHash('md5')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  /**
   * Check if loaded strategies match cached versions
   * Returns true if all hashes match
   */
  validateCache(loaded: Strategy[], cached: CachedStrategy[]): boolean {
    if (loaded.length !== cached.length) {
      return false;
    }

    const loadedMap = new Map(
      loaded.map(s => [s.name, this.hashStrategy(s)])
    );

    for (const cachedStrategy of cached) {
      const loadedHash = loadedMap.get(cachedStrategy.name);
      if (!loadedHash || loadedHash !== cachedStrategy.hash) {
        Logger.debug(`Hash mismatch for strategy: ${cachedStrategy.name}`);
        return false;
      }
    }

    return true;
  }
}
