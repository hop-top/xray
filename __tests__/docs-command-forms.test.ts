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
    // removed in the kit migration: --auto-configure never existed on the real CLI
    expect(text).not.toMatch(/--(no-)?auto-configure\b/);
    expect(text).not.toMatch(/new cliProgress\./);
  });
});

describe('docs do not present removed libraries as current', () => {
  const files = [...walk(path.join(ROOT, 'docs')), path.join(ROOT, 'README.md')]
    .filter(f => fs.existsSync(f));

  test.each(files.map(f => [path.relative(ROOT, f), f]))('%s', (_n, f) => {
    const text = fs.readFileSync(f, 'utf8');
    const stripped = text.replace(/^.*\b(removed|replaced|no longer|superseded)\b.*$/gim, '');
    expect(stripped).not.toMatch(/\b(chalk|cli-progress|@hop\/upgrade-ts)\b/);
  });
});

describe('docs show only commands and forms that exist', () => {
  const files = [
    ...walk(path.join(ROOT, 'docs')),
    ...walk(path.join(ROOT, 'skills')),
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'AGENTS.md'),
  ].filter(f => fs.existsSync(f));

  test.each(files.map(f => [path.relative(ROOT, f), f]))('%s', (_n, f) => {
    const text = fs.readFileSync(f, 'utf8');
    // explore takes no positional argument; strategies are `xray <strategy> <command>`
    expect(text).not.toMatch(/explore[ \t]+<?[A-Za-z-]*framework>?:/);
    expect(text).not.toMatch(/<framework>:[a-z<]/);
    // only `go-cli commands` exists; there is no glossary command
    expect(text).not.toMatch(/xray go-cli (flags|tree)\b/);
    expect(text).not.toMatch(/xray glossary\b/);
    // diagram output was removed
    // (`--format dot` of the build, cicd and infrastructure graph commands is separate and real)
    expect(text).not.toMatch(/--format[ =]mermaid\b/);
    expect(text).not.toMatch(/xray (map|graph)\b[^\n]*(--(mermaid|dot)\b|--format[ =]dot\b)/);
    // map/graph write files; their stdout is empty, so nothing can be piped or redirected
    expect(text).not.toMatch(/^[ \t]*xray (map|graph)\b[^\n#]*[ \t](\||>>?)[ \t]/m);
    // destructive commands refuse without --confirm=yes when there is no terminal
    expect(text).not.toMatch(/^[ \t]*xray (clear-cache|cache clear)(?![^\n]*--confirm)[ \t]*(&&|#|$)/m);
  });
});
