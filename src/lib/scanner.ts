import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import ignore from 'ignore';
import { execSync } from 'child_process';
import { Logger } from './logger';

export class FileScanner {
  private root: string;
  private ig: any;

  constructor(root: string) {
    this.root = root;
    this.ig = ignore();

    // Load .gitignore if exists
    const gitignorePath = path.join(root, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      this.ig.add(fs.readFileSync(gitignorePath, 'utf-8'));
    }

    // Add standard ignores
    this.ig.add(['.git', 'node_modules', 'dist', 'build', '*.min.js', '*.map', '.xray_cache.db']);
  }

  scan(): string[] {
    const supportedExts = ['.ts', '.js', '.py', '.tsx', '.jsx', '.go', '.java', '.c', '.cpp', '.rs', '.php'];

    try {
      const gitFiles = execSync('git ls-files --cached --others --exclude-standard', {
        cwd: this.root,
        encoding: 'utf8',
        stdio: 'pipe' // Prevent git from writing to stderr on the console
      });

      const files = gitFiles.split('\n').filter(file => file.trim() !== '');

      return files.filter(f => {
        const ext = path.extname(f);
        return supportedExts.includes(ext);
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

      // Filter using ignore rules and supported extensions
      return allFiles.filter(f => {
        if (this.ig.ignores(f)) return false;
        const ext = path.extname(f);
        return supportedExts.includes(ext);
      });
    }
  }
}
