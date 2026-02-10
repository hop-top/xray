// src/lib/config/json-parser.ts
import { ConfigParser, ParsedConfig, ConfigEntry } from './types';

export class JsonParser implements ConfigParser {
  canParse(filePath: string): boolean {
    return filePath.endsWith('.json') &&
           !filePath.endsWith('package.json') &&
           !filePath.endsWith('package-lock.json') &&
           !filePath.endsWith('tsconfig.json');
  }

  parse(content: string, filePath: string): ParsedConfig {
    const data = JSON.parse(content);
    const entries = this.flattenObject(data);

    return {
      entries,
      format: 'json',
      filePath
    };
  }

  private flattenObject(obj: any, prefix: string = ''): ConfigEntry[] {
    const entries: ConfigEntry[] = [];

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
      } else if (typeof value === 'object') {
        // Recursively flatten nested objects
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
