import { XrayPlugin } from '../../src/lib/events/plugin';
import { Xray } from '../../src/lib/xray';

/**
 * Metrics tracked by the MetricsCollectorPlugin
 */
export interface Metrics {
  totalFiles: number;
  filesScanned: number;
  filesSkipped: number;
  cacheHits: number;
  cacheMisses: number;
  parseErrors: number;
  totalTags: number;
  totalEdges: number;
  duration: number;
}

/**
 * MetricsCollectorPlugin - Collects and reports analysis metrics
 *
 * Tracks comprehensive metrics across the entire analysis pipeline:
 * - File scanning (total, scanned, skipped)
 * - Cache performance (hits, misses, hit rate)
 * - Parsing results (tags extracted, errors)
 * - Graph metrics (edges)
 * - Overall duration
 */
export class MetricsCollectorPlugin implements XrayPlugin {
  name = 'metrics-collector';
  version = '1.0.0';

  private metrics: Metrics = {
    totalFiles: 0,
    filesScanned: 0,
    filesSkipped: 0,
    cacheHits: 0,
    cacheMisses: 0,
    parseErrors: 0,
    totalTags: 0,
    totalEdges: 0,
    duration: 0
  };

  private startTime: number = 0;

  apply(xray: Xray): void {
    xray.on('scan:start', () => {
      this.startTime = Date.now();
    });

    xray.on('scan:complete', (event) => {
      this.metrics.totalFiles = event.files.length;
    });

    xray.on('scan:file', (event) => {
      if (event.skip) {
        this.metrics.filesSkipped++;
      } else {
        this.metrics.filesScanned++;
      }
    });

    xray.on('cache:hit', () => { this.metrics.cacheHits++; });
    xray.on('cache:miss', () => { this.metrics.cacheMisses++; });
    xray.on('parse:error', () => { this.metrics.parseErrors++; });

    xray.on('parse:after', (event) => {
      this.metrics.totalTags += event.tags.length;
    });

    xray.on('graph:complete', (event) => {
      this.metrics.totalEdges = event.edgeCount;
      this.metrics.duration = Date.now() - this.startTime;
    });

    xray.on('render:complete', () => {
      console.log('\n📊 Metrics Summary:');
      console.log(`  Files: ${this.metrics.filesScanned} scanned, ${this.metrics.filesSkipped} skipped`);
      console.log(`  Cache: ${this.metrics.cacheHits} hits, ${this.metrics.cacheMisses} misses (${this.cacheHitRate()}% hit rate)`);
      console.log(`  Parse: ${this.metrics.totalTags} tags extracted, ${this.metrics.parseErrors} errors`);
      console.log(`  Graph: ${this.metrics.totalEdges} edges`);
      console.log(`  Duration: ${(this.metrics.duration / 1000).toFixed(2)}s`);
    });
  }

  private cacheHitRate(): number {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    return total > 0 ? Math.round((this.metrics.cacheHits / total) * 100) : 0;
  }

  /**
   * Get a copy of the current metrics
   */
  getMetrics(): Metrics {
    return { ...this.metrics };
  }
}
