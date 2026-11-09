import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import ignore from 'ignore';
import { execFileSync } from 'child_process';
import { Logger } from './logger';
import { FileReadError } from './error/types';
import { knownExtensions } from './parser/grammars';
import { readTextSafe, noteSkip } from './safe-read';

/**
 * Paths git lists under `cwd` (tracked, plus untracked and not ignored), as
 * stored: NUL-separated (`-z`), so names with non-ASCII bytes, spaces,
 * tabs or newlines are not quoted by `core.quotepath` and survive intact.
 * Throws when `cwd` is not in a repository or git is unavailable.
 */
export function gitListFiles(cwd: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe', // Prevent git from writing to stderr on the console
    maxBuffer: 1024 * 1024 * 1024,
  });
  return out.split('\0').filter(file => file !== '');
}

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
        this.ig.add(readTextSafe(root, '.gitignore'));
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
      execFileSync('git', ['check-ignore', '-q', '--', path.basename(real)], { cwd: dir, stdio: 'pipe' });
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
   * through them would disclose files the scan never meant to cover. Entries
   * that are not regular files (FIFOs, devices, sockets) are dropped too.
   */
  private dropEscapingLinks(files: string[]): string[] {
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(this.root);
    } catch {
      return files;
    }
    const listed = new Set(files.map((f) => f.split(path.sep).join('/')));
    return files.filter((f) => {
      const abs = path.join(this.root, f);
      try {
        const st = fs.lstatSync(abs);
        if (!st.isSymbolicLink()) {
          // A FIFO, socket or device would block or never end when read.
          if (st.isFile()) return true;
          noteSkip('not-regular', f);
          return false;
        }
        const real = fs.realpathSync(abs);
        const rel = path.relative(realRoot, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          noteSkip('outside-root', f);
          return false;
        }
        // Followed only when the target is itself a listed file: not
        // ignored, not under .git, of a supported extension.
        return listed.has(rel.split(path.sep).join('/')) && fs.statSync(real).isFile();
      } catch {
        return false;
      }
    });
  }

  /** Files under the root with one of `extensions` (default: supportedExtensions()). */
  scan(extensions: Iterable<string> = FileScanner.supportedExtensions()): string[] {
    const supportedExts = new Set(extensions);

    try {
      const files = gitListFiles(this.root);

      return this.dropEscapingLinks(files.filter(f => {
        const ext = path.extname(f);
        return supportedExts.has(ext);
      }));
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
        }))
        .sort();
    }
  }
}
