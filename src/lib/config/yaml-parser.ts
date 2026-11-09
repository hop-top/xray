// src/lib/config/yaml-parser.ts
import * as yaml from 'js-yaml';
import { ConfigParser, ParsedConfig, ConfigEntry } from './types';

export class YamlParser implements ConfigParser {
  canParse(filePath: string): boolean {
    return filePath.endsWith('.yml') ||
           filePath.endsWith('.yaml');
  }

  parse(content: string, filePath: string): ParsedConfig {
    const data = yaml.load(content);
    const entries = this.flattenObject(data);

    return {
      entries,
      format: 'yaml',
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
