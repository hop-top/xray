// src/strategy/detector.ts
import * as fs from 'fs';
import * as path from 'path';
import { Strategy, DetectedStrategy, StrategyContext } from './types';
import { StrategyLoader } from './loader';

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
    const detected: DetectedStrategy[] = [];

    for (const strategy of strategies) {
      try {
        const isApplicable = await strategy.detect(this.context);
        if (isApplicable) {
          detected.push({
            name: strategy.name,
            version: strategy.version,
            detectedAt: Date.now()
          });
        }
      } catch (error) {
        console.warn(`Strategy detection failed for ${strategy.name}:`, error);
      }
    }

    return detected;
  }

  async runDetection(): Promise<DetectedStrategy[]> {
    const strategies = await this.loader.discoverStrategies();
    const detected = await this.detect(strategies);

    // Save to file
    const xrayDir = path.join(this.context.getProjectRoot(), '.xray');
    if (!fs.existsSync(xrayDir)) {
      fs.mkdirSync(xrayDir, { recursive: true });
    }

    fs.writeFileSync(
      this.detectionFile,
      JSON.stringify(detected, null, 2),
      'utf-8'
    );

    return detected;
  }

  getDetectedStrategies(): DetectedStrategy[] | null {
    if (!fs.existsSync(this.detectionFile)) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.detectionFile, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.warn('Failed to read detected strategies:', error);
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
