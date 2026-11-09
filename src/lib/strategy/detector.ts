// src/strategy/detector.ts
import * as fs from 'fs';
import * as path from 'path';
import {
  Extension,
  Strategy,
  DetectedStrategy,
  StrategyContext,
  normalizeDetectedStrategy,
  strategyToExtension,
} from './types';
import { StrategyLoader } from './loader';
import { cachePath, ensurePrivateDir, ensurePrivateFile, projectKey } from '../storage';
import { Logger } from '../logger';

export class StrategyDetector {
  private loader: StrategyLoader;
  private context: StrategyContext;
  /** Undefined when there is no usable cache dir: nothing is cached. */
  private detectionFile: string | undefined;

  constructor(loader: StrategyLoader, context: StrategyContext) {
    this.loader = loader;
    this.context = context;
    this.detectionFile = cachePath(
      'strategies', projectKey(context.getProjectRoot()), 'detected-strategies.json'
    );
  }

  async detect(strategies: Strategy[]): Promise<DetectedStrategy[]> {
    return this.detectExtensions(strategies.map(strategyToExtension));
  }

  async detectExtensions(extensions: Extension[]): Promise<DetectedStrategy[]> {
    const detected: DetectedStrategy[] = [];

    for (const extension of extensions) {
      try {
        const strategyDetection = normalizeDetectedStrategy(
          extension.strategy || extension,
          await extension.detect(this.context)
        );
        if (strategyDetection) {
          detected.push(strategyDetection);
        }
      } catch (error) {
        Logger.warn(`Extension detection failed for ${extension.name}: ${error}`);
      }
    }

    return detected;
  }

  async runDetection(extensions?: Extension[]): Promise<DetectedStrategy[]> {
    const exts = extensions || await this.loader.discoverExtensions();
    const detected = await this.detectExtensions(exts);

    // Optional cache in the user cache dir, never in the project.
    const file = this.detectionFile;
    if (file) {
      try {
        if (!ensurePrivateDir(path.dirname(file)) || !ensurePrivateFile(file)) {
          throw new Error(`${path.dirname(file)} cannot be made private to this user`);
        }
        fs.writeFileSync(file, JSON.stringify(detected, null, 2), 'utf-8');
      } catch (err: any) {
        // Log warning but don't fail - detection cache is optional
        Logger.warn(`Could not write strategy detection cache: ${err.message}`);
      }
    }

    return detected;
  }

  getDetectedStrategies(): DetectedStrategy[] | null {
    const file = this.detectionFile;
    if (!file || !fs.existsSync(file)) {
      return null;
    }

    try {
      const content = fs.readFileSync(file, 'utf-8');
      return JSON.parse(content);
    } catch (err: any) {
      Logger.warn(`Failed to read detected strategies: ${err.message}`);
      return null;
    }
  }

  needsRefresh(): boolean {
    const file = this.detectionFile;
    if (!file || !fs.existsSync(file)) {
      return true;
    }

    const stats = fs.statSync(file);
    const age = Date.now() - stats.mtimeMs;

    // Refresh if older than 1 hour (will be handled by pre-commit hook normally)
    return age > 60 * 60 * 1000;
  }
}
