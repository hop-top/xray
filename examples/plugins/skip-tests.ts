import { XrayPlugin } from '../../src/lib/events/plugin';
import { Xray } from '../../src/lib/xray';

/**
 * SkipTestsPlugin - Skips test files during scanning
 *
 * Supports glob patterns with * and ? wildcards
 * Default patterns skip common test file conventions:
 * - *.test.* (e.g., app.test.ts)
 * - *.spec.* (e.g., component.spec.tsx)
 * - __tests__/** (e.g., __tests__/unit/app.ts)
 */
export class SkipTestsPlugin implements XrayPlugin {
  name = 'skip-tests';
  version = '1.0.0';

  private patterns: RegExp[];

  constructor(patterns: string[] = ['*.test.*', '*.spec.*', '__tests__/**']) {
    this.patterns = patterns.map(p =>
      new RegExp('^' + p.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
    );
  }

  apply(xray: Xray): void {
    xray.on('scan:file', (event) => {
      for (const pattern of this.patterns) {
        if (pattern.test(event.file)) {
          event.skip = true;
          break;
        }
      }
    });
  }
}
