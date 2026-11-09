// src/strategy/context.ts
import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import type { XrayExtensionConfig } from '../../types/xray-config';
import { StrategyContext, FileQuery, StrategyContextOptions } from './types';
import { FileReadError } from '../error/types';
import { Logger } from '../logger';
import { readTextSafe, isSafeEntry, UnsafeFileError } from '../safe-read';

export class StrategyContextImpl implements StrategyContext {
  private root: string;
  private packageJson: any = null;
  private cache: Map<string, any> = new Map();
  private fileTags: Map<string, Set<string>> = new Map();
  private fileMetadata: Map<string, Map<string, any>> = new Map();
  private globCache: Map<string, string[]> = new Map();
  private extensionConfig: Map<string, XrayExtensionConfig> = new Map();

  constructor(root: string, options: StrategyContextOptions = {}) {
    // Relative roots resolve against cwd once; every join below assumes absolute.
    this.root = path.resolve(root);
    this.loadExtensionConfig(options.extensions);
    this.loadPackageJson();
  }

  private loadExtensionConfig(
    extensions?: Record<string, XrayExtensionConfig>
  ): void {
    for (const [name, config] of Object.entries(extensions || {})) {
      this.extensionConfig.set(name, config);
    }
  }

  private loadPackageJson(): void {
    const pkgPath = path.join(this.root, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const content = readTextSafe(this.root, 'package.json');
        this.packageJson = JSON.parse(content);
      } catch (err: any) {
        // Log warning but don't fail - package.json is optional for strategy detection.
        // A refused file is tallied and reported once instead.
        if (err instanceof UnsafeFileError) return;
        Logger.warn(`Could not read package.json: ${err.message}`);
      }
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
    return globSync(pattern, { cwd: this.root }).some(f => isSafeEntry(this.root, f));
  }

  async parseAST(file: string): Promise<any> {
    // Placeholder - will integrate with existing parser
    throw new Error('Not implemented yet');
  }

  async readFile(file: string): Promise<string> {
    // Regular files inside the project root only, within the size cap.
    return readTextSafe(this.root, file);
  }

  async findFiles(query: FileQuery): Promise<string[]> {
    // Build targeted glob pattern when possible
    let pattern = '**/*';
    let needsFiltering = false;

    if (query.extension) {
      // Use glob pattern for extension filtering (much faster)
      pattern = `**/*${query.extension}`;
    }

    // Get files using targeted pattern
    const files = globSync(pattern, {
      cwd: this.root,
      nodir: true,
      ignore: ['node_modules/**', '.git/**']
    }).filter(f => isSafeEntry(this.root, f));

    // Only apply complex filters that can't be done by glob
    if (query.pattern || query.tagged) {
      return files.filter(file => {
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

    return files;
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
    // Check cache first
    if (this.globCache.has(pattern)) {
      return this.globCache.get(pattern)!;
    }

    // Perform glob operation
    const files = globSync(pattern, { cwd: this.root }).filter(f => isSafeEntry(this.root, f));

    // Cache the result
    this.globCache.set(pattern, files);

    return files;
  }

  getProjectRoot(): string {
    return this.root;
  }

  getConfig(key: string): any {
    const segments = key.split('.');
    if (segments.length === 0) {
      return undefined;
    }

    const [extensionName, ...pathSegments] = segments;
    const extensionConfig = this.getExtensionConfig(extensionName);
    if (!extensionConfig) {
      return undefined;
    }

    if (pathSegments.length === 0) {
      return extensionConfig;
    }

    return pathSegments.reduce<any>((value, segment) => {
      if (!value || typeof value !== 'object') {
        return undefined;
      }
      return value[segment as keyof typeof value];
    }, extensionConfig);
  }

  getExtensionConfig(name: string): XrayExtensionConfig | undefined {
    return this.extensionConfig.get(name);
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

  /**
   * Clear the glob cache. Useful when file system changes are detected.
   */
  clearGlobCache(): void {
    this.globCache.clear();
  }

  /**
   * Clear a specific cached glob pattern
   */
  clearCachedPattern(pattern: string): void {
    this.globCache.delete(pattern);
  }

  /**
   * Add a file tag to the context
   */
  addFileTag(file: string, tag: string): void {
    if (!this.fileTags.has(file)) {
      this.fileTags.set(file, new Set());
    }
    this.fileTags.get(file)!.add(tag);
  }

  /**
   * Set file metadata for a strategy
   */
  setFileMetadata(file: string, strategy: string, metadata: any): void {
    if (!this.fileMetadata.has(file)) {
      this.fileMetadata.set(file, new Map());
    }
    this.fileMetadata.get(file)!.set(strategy, metadata);
  }

  setExtensionConfig(name: string, config: XrayExtensionConfig): void {
    this.extensionConfig.set(name, config);
  }
}
