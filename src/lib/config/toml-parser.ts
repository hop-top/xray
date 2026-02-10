// src/lib/config/toml-parser.ts
import * as toml from '@iarna/toml';
import { ConfigParser, ParsedConfig, ConfigEntry } from './types';

export class TomlParser implements ConfigParser {
  canParse(filePath: string): boolean {
    return filePath.endsWith('.toml');
  }

  parse(content: string, filePath: string): ParsedConfig {
    const data = toml.parse(content);
    const entries = this.flattenObject(data);

    return {
      entries,
      format: 'toml',
      filePath
    };
  }

  private flattenObject(obj: any, prefix: string = ''): ConfigEntry[] {
    const entries: ConfigEntry[] = [];

    if (!obj || typeof obj !== 'object') {
      return entries;
    }

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (value === null || value === undefined) {
        entries.push({
          key: fullKey,
          value: value
        });
      } else if (Array.isArray(value)) {
        entries.push({
          key: fullKey,
          value: value
        });
      } else if (typeof value === 'object' && !(value instanceof Date)) {
        // Recursively flatten nested objects (but not Date objects)
        entries.push(...this.flattenObject(value, fullKey));
      } else {
        entries.push({
          key: fullKey,
          value: value
        });
      }
    }

    return entries;
  }
}
