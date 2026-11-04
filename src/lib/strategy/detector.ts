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
import { FileReadError, FileWriteError } from '../error/types';
import { Logger } from '../logger';

export class StrategyDetector {
  private loader: StrategyLoader;
  private context: StrategyContext;
  private detectionFile: string;

  constructor(loader: StrategyLoader, context: StrategyContext) {
    this.loader = loader;
    this.context = context;
    this.detectionFile = path.join(context.getProjectRoot(), '.xray/detected-strategies.json');
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

    // Save to file
    const xrayDir = path.join(this.context.getProjectRoot(), '.xray');
    try {
      if (!fs.existsSync(xrayDir)) {
        fs.mkdirSync(xrayDir, { recursive: true });
      }

      fs.writeFileSync(
        this.detectionFile,
        JSON.stringify(detected, null, 2),
        'utf-8'
      );
    } catch (err: any) {
      // Log warning but don't fail - detection cache is optional
      Logger.warn(
        err?.code === 'ENOTDIR' || (fs.existsSync(xrayDir) && !fs.statSync(xrayDir).isDirectory())
          ? `.xray is a file, but xray keeps its cache in a .xray directory: ${xrayDir}. ` +
            `The detection cache was not written; remove or rename the file to enable it.`
          : `Could not write strategy detection cache: ${err.message}`
      );
    }

    return detected;
  }

  getDetectedStrategies(): DetectedStrategy[] | null {
    if (!fs.existsSync(this.detectionFile)) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.detectionFile, 'utf-8');
      return JSON.parse(content);
    } catch (err: any) {
      Logger.warn(`Failed to read detected strategies: ${err.message}`);
      return null;
    }
  }

  needsRefresh(): boolean {
    if (!fs.existsSync(this.detectionFile)) {
      return true;
    }

    const stats = fs.statSync(this.detectionFile);
    const age = Date.now() - stats.mtimeMs;

    // Refresh if older than 1 hour (will be handled by pre-commit hook normally)
    return age > 60 * 60 * 1000;
  }
}
