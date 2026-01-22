import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../lib/logger';
import { FileScanner } from '../lib/scanner';
import { resolvePath } from './common';

export const handleExploreAction = async (query: string | undefined, options: any) => {
  try {
    const paths = (options.path && options.path.length > 0 ? options.path : [process.cwd()])
      .map(resolvePath)
      .filter(Boolean) as string[];

    // Validate all paths exist
    for (const p of paths) {
      if (!fs.existsSync(p)) {
        Logger.error(`Path does not exist: ${p}`);
        process.exit(1);
      }
    }

    // Scan all paths and collect files
    let files: string[] = [];
    for (const p of paths) {
      const scanner = new FileScanner(p);
      const scannedFiles = scanner.scan().map((f: string) => path.join(p, f));
      files = files.concat(scannedFiles);
    }

    // Filter by type if specified
    if (options.type && options.type.length > 0) {
      const exts = options.type.map((t: string) => t.startsWith('.') ? t : `.${t}`);
      files = files.filter(f => exts.includes(path.extname(f)));
    }

    // Find files by pattern
    if (options.match && options.match.length > 0) {
      files = files.filter(f => {
        const fileName = path.basename(f).toLowerCase();
        const filePath = f.toLowerCase();

        return options.match.some((pattern: string) => {
          const isNegated = pattern.startsWith('!');
          const actualPattern = (isNegated ? pattern.slice(1) : pattern).toLowerCase();

          let matches = false;

          // Support glob-like patterns
          if (actualPattern.includes('*')) {
            const regex = new RegExp(actualPattern.replace(/\*/g, '.*'));
            matches = regex.test(filePath);
          } else {
            matches = fileName.includes(actualPattern) || filePath.includes(actualPattern);
          }

          return isNegated ? !matches : matches;
        });
      });

      Logger.info(`Found ${files.length} file(s) matching pattern(s):\n`);
      files.forEach(f => console.log(`  ${f}`));
      return;
    }

    // Search for keyword in code
    if (options.search && options.search.length > 0) {
      const keywords = options.search;
      Logger.info(`Searching for ${keywords.length} keyword(s) in ${files.length} files...\n`);

      const matches: Array<{ file: string; lines: Array<{ lineNum: number; content: string; keyword: string }> }> = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(file, 'utf-8');
          const lines = content.split('\n');
          const matchingLines: Array<{ lineNum: number; content: string; keyword: string }> = [];

          lines.forEach((line, idx) => {
            keywords.forEach((keyword: string) => {
              if (line.toLowerCase().includes(keyword.toLowerCase())) {
                matchingLines.push({ lineNum: idx + 1, content: line.trim(), keyword });
              }
            });
          });

          if (matchingLines.length > 0) {
            matches.push({ file, lines: matchingLines });
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }

      if (matches.length === 0) {
        Logger.warn(`No matches found for keyword(s): ${keywords.join(', ')}`);
        return;
      }

      Logger.success(`Found matches in ${matches.length} file(s):\n`);
      matches.forEach(({ file, lines }) => {
        console.log(require('chalk').cyan(`${file}:`));
        lines.slice(0, 5).forEach(({ lineNum, content, keyword }) => {
          console.log(`  ${require('chalk').gray(`${lineNum}:`)} ${require('chalk').yellow(`[${keyword}]`)} ${content}`);
        });
        if (lines.length > 5) {
          console.log(require('chalk').gray(`  ... and ${lines.length - 5} more matches`));
        }
        console.log('');
      });
      return;
    }

    // Show statistics
    if (options.stats) {
      const extStats: Record<string, number> = {};
      let totalLines = 0;

      files.forEach(file => {
        const ext = path.extname(file);
        extStats[ext] = (extStats[ext] || 0) + 1;

        try {
          const content = fs.readFileSync(file, 'utf-8');
          totalLines += content.split('\n').length;
        } catch (error) {
          // Skip files that can't be read
        }
      });

      Logger.info('Codebase Statistics:\n');
      console.log(`  ${require('chalk').bold('Total Files:')} ${files.length}`);
      console.log(`  ${require('chalk').bold('Total Lines:')} ${totalLines.toLocaleString()}\n`);
      console.log(`  ${require('chalk').bold('Files by Type:')}`);

      Object.entries(extStats)
        .sort((a, b) => b[1] - a[1])
        .forEach(([ext, count]) => {
          console.log(`    ${ext.padEnd(10)} ${count}`);
        });
      return;
    }

    // Default: list all files
    Logger.info(`Found ${files.length} file(s):\n`);

    // Group by extension
    const byExt: Record<string, string[]> = {};
    files.forEach(f => {
      const ext = path.extname(f);
      if (!byExt[ext]) byExt[ext] = [];
      byExt[ext].push(f);
    });

    Object.entries(byExt)
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([ext, fileList]) => {
        console.log(require('chalk').cyan(`${ext} (${fileList.length}):`));
        fileList.slice(0, 10).forEach(f => console.log(`  ${f}`));
        if (fileList.length > 10) {
          console.log(require('chalk').gray(`  ... and ${fileList.length - 10} more`));
        }
        console.log('');
      });

  } catch (error) {
    Logger.error('Error exploring codebase:', error);
    process.exit(1);
  }
};