// src/lib/config/env-parser.ts
import { ConfigParser, ParsedConfig, ConfigEntry } from './types';

const SENSITIVE_KEY_PATTERNS = [
  /key/i,
  /secret/i,
  /password/i,
  /token/i,
  /credential/i,
  /auth/i,
  /private/i,
  /api[_-]?key/i,
  /access[_-]?token/i,
];

export class EnvParser implements ConfigParser {
  canParse(filePath: string): boolean {
    return filePath.endsWith('.env') ||
           filePath.includes('.env.') ||
           filePath.endsWith('.env.local') ||
           filePath.endsWith('.env.production') ||
           filePath.endsWith('.env.development') ||
           filePath.endsWith('.env.test');
  }

  parse(content: string, filePath: string): ParsedConfig {
    const entries: ConfigEntry[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse KEY=VALUE format
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (match) {
        const [, key, rawValue] = match;

        // Remove quotes if present
        let value = rawValue.trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        // Check if key is sensitive
        const sensitive = this.isSensitiveKey(key);

        entries.push({
          key,
          value,
          sensitive
        });
      }
    }

    return {
      entries,
      format: 'env',
      filePath
    };
  }

  private isSensitiveKey(key: string): boolean {
    return SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(key));
  }
}
