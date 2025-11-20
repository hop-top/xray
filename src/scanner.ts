import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import ignore from 'ignore';

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
    this.ig.add(['.git', 'node_modules', 'dist', 'build', '*.min.js', '*.map', '.repomap_cache.db']);
  }

  scan(): string[] {
    // Get all files recursively
    const allFiles = globSync('**/*', { 
      cwd: this.root, 
      nodir: true, 
      dot: true,
      ignore: ['.git/**'] 
    });

    // Filter using ignore rules and supported extensions
    const supportedExts = ['.ts', '.js', '.py', '.tsx', '.jsx', '.go', '.java', '.c', '.cpp', '.rs', '.php'];
    
    return allFiles.filter(f => {
      if (this.ig.ignores(f)) return false;
      const ext = path.extname(f);
      return supportedExts.includes(ext);
    });
  }
}
