import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import ignore from 'ignore';
import { execSync } from 'child_process';
import { Logger } from './logger';
import { FileReadError } from './error/types';
import { knownExtensions } from './parser/grammars';

export class FileScanner {
  private root: string;
  private ig: any;

  constructor(root: string) {
    this.root = root;
    this.ig = ignore();

    // Load .gitignore if exists
    const gitignorePath = path.join(root, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      try {
        this.ig.add(fs.readFileSync(gitignorePath, 'utf-8'));
      } catch (err: any) {
        // If .gitignore is unreadable, log warning but continue
        Logger.warn(`Could not read .gitignore: ${err.message}`);
      }
    }

    // Add standard ignores
    this.ig.add(['.git', 'node_modules', 'dist', 'build', '*.min.js', '*.map', '.xray_cache.db']);
  }

  /**
   * Extensions discovered by the scanner: every language in the grammar
   * catalog, installed or not (files without a grammar are reported, not parsed).
   */
  static supportedExtensions(): string[] {
    return knownExtensions();
  }

  scan(): string[] {
    const supportedExts = new Set(FileScanner.supportedExtensions());

    try {
      const gitFiles = execSync('git ls-files --cached --others --exclude-standard', {
        cwd: this.root,
        encoding: 'utf8',
        stdio: 'pipe' // Prevent git from writing to stderr on the console
      });

      const files = gitFiles.split('\n').filter(file => file.trim() !== '');

      return files.filter(f => {
        const ext = path.extname(f);
        return supportedExts.has(ext);
      });
    } catch (error) {
      Logger.warn('Not a git repository or git is not available. Falling back to manual file scanning. This might be slower and include files ignored by git.');

      // Get all files recursively
      const allFiles = globSync('**/*', {
        cwd: this.root,
        nodir: true,
        dot: true,
        ignore: ['.git/**']
      });

      // Filter using ignore rules and supported extensions. glob lists entries in
      // directory order, which differs per filesystem; sort so downstream ranking
      // ties (and thus `map` output) are the same everywhere. Matches the order
      // `git ls-files` returns above.
      return allFiles
        .filter(f => {
          if (this.ig.ignores(f)) return false;
          const ext = path.extname(f);
          return supportedExts.has(ext);
        })
        .sort();
    }
  }
}
