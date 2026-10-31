import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['CHANGELOG.md', 'telemetry.md', 'telemetry-coverage.md', 'command-structure.md']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md') && !SKIP.has(e.name)) out.push(p);
  }
  return out;
}

describe('docs use space-separated strategy commands', () => {
  const files = [...walk(path.join(ROOT, 'docs')), ...walk(path.join(ROOT, 'skills')), path.join(ROOT, 'README.md')]
    .filter(f => fs.existsSync(f));

  test.each(files.map(f => [path.relative(ROOT, f), f]))('%s', (_n, f) => {
    const text = fs.readFileSync(f, 'utf8');
    expect(text).not.toMatch(/\bstrategy:(detect|list|info)\b/);
    expect(text).not.toMatch(/xray (react|express|rest-api|go-cli|package-manager):[a-z]/);
  });
});
