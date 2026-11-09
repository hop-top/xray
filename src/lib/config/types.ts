// src/lib/config/types.ts

export interface ConfigEntry {
  key: string;
  value: any;
  sensitive?: boolean;
}

export interface ParsedConfig {
  entries: ConfigEntry[];
  format: 'env' | 'json' | 'yaml' | 'toml';
  filePath: string;
}

export interface ConfigParser {
  parse(content: string, filePath: string): ParsedConfig;
  canParse(filePath: string): boolean;
}
