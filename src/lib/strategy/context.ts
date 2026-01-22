// src/strategy/context.ts
import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import { StrategyContext, FileQuery } from './types';

export class StrategyContextImpl implements StrategyContext {
  private root: string;
  private packageJson: any = null;
  private cache: Map<string, any> = new Map();
  private fileTags: Map<string, Set<string>> = new Map();
  private fileMetadata: Map<string, Map<string, any>> = new Map();

  constructor(root: string) {
    this.root = root;
    this.loadPackageJson();
  }

  private loadPackageJson(): void {
    const pkgPath = path.join(this.root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      this.packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    }
  }

  hasDependency(name: string): boolean {
    if (!this.packageJson) return false;
    return !!(this.packageJson.dependencies?.[name]);
  }

  hasDevDependency(name: string): boolean {
    if (!this.packageJson) return false;
    return !!(this.packageJson.devDependencies?.[name]);
  }

  hasFiles(pattern: string): boolean {
    const files = globSync(pattern, { cwd: this.root });
    return files.length > 0;
  }

  async parseAST(file: string): Promise<any> {
    // Placeholder - will integrate with existing parser
    throw new Error('Not implemented yet');
  }

  async readFile(file: string): Promise<string> {
    const filePath = path.isAbsolute(file) ? file : path.join(this.root, file);
    return fs.promises.readFile(filePath, 'utf-8');
  }

  async findFiles(query: FileQuery): Promise<string[]> {
    const allFiles = globSync('**/*', {
      cwd: this.root,
      nodir: true,
      ignore: ['node_modules/**', '.git/**']
    });

    return allFiles.filter(file => {
      if (query.extension && !file.endsWith(query.extension)) {
        return false;
      }

      if (query.pattern && !file.includes(query.pattern)) {
        return false;
      }

      if (query.tagged) {
        const tags = Array.isArray(query.tagged) ? query.tagged : [query.tagged];
        const fileTags = this.getTags(file);
        return tags.every(tag => fileTags.includes(tag));
      }

      return true;
    });
  }

  hasTag(file: string, tag: string): boolean {
    return this.fileTags.get(file)?.has(tag) ?? false;
  }

  getTags(file: string): string[] {
    return Array.from(this.fileTags.get(file) ?? []);
  }

  getMetadata(file: string, strategy: string): any {
    return this.fileMetadata.get(file)?.get(strategy);
  }

  getCached(key: string): any {
    return this.cache.get(key);
  }

  setCached(key: string, value: any): void {
    this.cache.set(key, value);
  }

  globFiles(pattern: string): string[] {
    return globSync(pattern, { cwd: this.root });
  }

  getProjectRoot(): string {
    return this.root;
  }

  getConfig(key: string): any {
    // Placeholder - will integrate with existing config
    return undefined;
  }

  // Internal methods for strategy system
  addTag(file: string, tag: string): void {
    if (!this.fileTags.has(file)) {
      this.fileTags.set(file, new Set());
    }
    this.fileTags.get(file)!.add(tag);
  }

  setMetadata(file: string, strategy: string, metadata: any): void {
    if (!this.fileMetadata.has(file)) {
      this.fileMetadata.set(file, new Map());
    }
    this.fileMetadata.get(file)!.set(strategy, metadata);
  }
}
