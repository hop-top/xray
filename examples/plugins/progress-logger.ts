import { XrayPlugin } from '../../src/lib/events/plugin';
import { Xray } from '../../src/lib/xray';
import { styles } from '../../src/lib/tui';

/**
 * ProgressLoggerPlugin - Logs analysis progress to the console
 *
 * Provides colored, formatted output for:
 * - Scan start/complete
 * - Progress bars during parsing/ranking
 * - Graph build completion with timing
 * - Final render completion with total time
 */
export class ProgressLoggerPlugin implements XrayPlugin {
  name = 'progress-logger';
  version = '1.0.0';

  private startTime: number = 0;

  apply(xray: Xray): void {
    xray.on('scan:start', (event) => {
      this.startTime = Date.now();
      console.log(styles().accent(`🔍 Scanning ${event.path}...`));
    });

    xray.on('scan:complete', (event) => {
      console.log(styles().success(`✓ Found ${event.files.length} files`));
    });

    xray.on('progress', (event) => {
      const percent = Math.round((event.current / event.total) * 100);
      const bar = '█'.repeat(percent / 2) + '░'.repeat(50 - percent / 2);
      process.stdout.write(`\r${bar} ${percent}% - ${event.message}`);

      if (event.current >= event.total) {
        console.log();
      }
    });

    xray.on('graph:complete', (event) => {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
      console.log(styles().success(`✓ Built graph: ${event.nodeCount} nodes, ${event.edgeCount} edges (${elapsed}s)`));
    });

    xray.on('render:complete', (event) => {
      const total = ((Date.now() - this.startTime) / 1000).toFixed(2);
      console.log(styles().success(`✓ Analysis complete: ${event.outputPath} (${total}s total)`));
    });
  }
}
