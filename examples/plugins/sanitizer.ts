import { XrayPlugin } from '../../src/lib/events/plugin';
import { Xray } from '../../src/lib/xray';

/**
 * Pattern for redacting sensitive content
 */
export interface SanitizerPattern {
  pattern: RegExp;
  replacement: string;
}

/**
 * SanitizerPlugin - Redacts sensitive information from code and docstrings
 *
 * Default patterns redact:
 * - Bearer tokens
 * - API keys
 * - Passwords
 *
 * Custom patterns can be provided via constructor
 */
export class SanitizerPlugin implements XrayPlugin {
  name = 'sanitizer';
  version = '1.0.0';

  private patterns: SanitizerPattern[];

  constructor(patterns: SanitizerPattern[] = []) {
    this.patterns = patterns.length > 0 ? patterns : [
      { pattern: /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/g, replacement: 'Bearer [REDACTED]' },
      { pattern: /api[\s_-]?key['":\s=]+['"]?[A-Za-z0-9_]{20,}['"]?/gi, replacement: 'api_key: "[REDACTED]"' },
      { pattern: /password['":\s=]+['"]?[^'";\s]+['"]?/gi, replacement: 'password: "[REDACTED]"' }
    ];
  }

  apply(xray: Xray): void {
    // Sanitize file content before parsing
    xray.on('parse:before', (event) => {
      for (const { pattern, replacement } of this.patterns) {
        event.content = event.content.replace(pattern, replacement);
      }
    });

    // Sanitize docstrings
    xray.on('parse:after', (event) => {
      event.tags = event.tags.map(tag => {
        if (tag.doc) {
          for (const { pattern, replacement } of this.patterns) {
            tag.doc = tag.doc.replace(pattern, replacement);
          }
        }
        return tag;
      });
    });
  }
}
