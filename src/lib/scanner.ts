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

  /**
   * Why `file` (an explicitly named path) would not have been scanned, or
   * null when the scanner rules admit it: a supported extension, not under
   * `.git`, not ignored (git, else the nearest .gitignore and the standard
   * ignores). A symlink is judged by what it points at.
   */
  static skipReason(file: string, extensions: Iterable<string> = FileScanner.supportedExtensions()): string | null {
    let real: string;
    try {
      real = fs.realpathSync(file);
    } catch {
      return 'cannot be resolved';
    }
    if (real.split(path.sep).includes('.git')) return 'is under .git';
    if (!new Set(extensions).has(path.extname(real))) return `has an unsupported extension (${path.extname(real) || 'none'})`;
    const dir = path.dirname(real);
    try {
      execSync(`git check-ignore -q -- ${JSON.stringify(path.basename(real))}`, { cwd: dir, stdio: 'pipe' });
      return 'is ignored by git';
    } catch (err: any) {
      if (err?.status === 1) return null; // a repo, and not ignored
    }
    // Not a repo (or no git): nearest .gitignore walking up, plus the standard ignores.
    let top = dir;
    for (let d = dir; ; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, '.gitignore'))) top = d;
      if (path.dirname(d) === d) break;
    }
    const scanner = new FileScanner(top);
    return scanner.ig.ignores(path.relative(top, real).split(path.sep).join('/')) ? 'is ignored' : null;
  }

  /**
   * Symlinks that leave the root, or point at something the scanner would
   * not list (`.env`, anything under `.git`), are not followed: reading
   * through them would disclose files the scan never meant to cover.
   */
  private dropEscapingLinks(files: string[], exts: ReadonlySet<string>): string[] {
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(this.root);
    } catch {
      return files;
    }
    return files.filter((f) => {
      const abs = path.join(this.root, f);
      try {
        if (!fs.lstatSync(abs).isSymbolicLink()) return true;
        const real = fs.realpathSync(abs);
        const rel = path.relative(realRoot, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
        const parts = rel.split(path.sep);
        if (parts.includes('.git')) return false;
        return exts.has(path.extname(real));
      } catch {
        return false;
      }
    });
  }

  /** Files under the root with one of `extensions` (default: supportedExtensions()). */
  scan(extensions: Iterable<string> = FileScanner.supportedExtensions()): string[] {
    const supportedExts = new Set(extensions);

    try {
      const gitFiles = execSync('git ls-files --cached --others --exclude-standard', {
        cwd: this.root,
        encoding: 'utf8',
        stdio: 'pipe' // Prevent git from writing to stderr on the console
      });

      const files = gitFiles.split('\n').filter(file => file.trim() !== '');

      return this.dropEscapingLinks(files.filter(f => {
        const ext = path.extname(f);
        return supportedExts.has(ext);
      }), supportedExts);
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
      return this.dropEscapingLinks(allFiles
        .filter(f => {
          if (this.ig.ignores(f)) return false;
          const ext = path.extname(f);
          return supportedExts.has(ext);
        }), supportedExts)
        .sort();
    }
  }
}
