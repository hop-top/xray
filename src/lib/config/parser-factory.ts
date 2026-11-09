// src/lib/config/parser-factory.ts
import { ConfigParser } from './types';
import { EnvParser } from './env-parser';
import { JsonParser } from './json-parser';
import { YamlParser } from './yaml-parser';
import { TomlParser } from './toml-parser';

export class ParserFactory {
  private parsers: ConfigParser[];

  constructor() {
    this.parsers = [
      new EnvParser(),
      new JsonParser(),
      new YamlParser(),
      new TomlParser()
    ];
  }

  getParser(filePath: string): ConfigParser | null {
    return this.parsers.find(parser => parser.canParse(filePath)) || null;
  }

  isConfigFile(filePath: string): boolean {
    return this.parsers.some(parser => parser.canParse(filePath));
  }
}
