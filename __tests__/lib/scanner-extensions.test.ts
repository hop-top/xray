/**
 * The scanner discovers every language in the grammar catalog: its extension
 * list is derived from LANGUAGE_PACKS, never a hand-maintained literal.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileScanner } from '../../src/lib/scanner';
import { LANGUAGE_PACKS, knownExtensions } from '../../src/lib/parser/grammars';
import { Logger } from '../../src/lib/logger';

const catalogExts = (): string[] => Array.from(new Set(LANGUAGE_PACKS.flatMap(p => p.extensions))).sort();

function makeRepo(git: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-scan-'));
  catalogExts().forEach((ext, i) => fs.writeFileSync(path.join(dir, `f${i}${ext}`), ''));
  for (const other of ['README.md', 'notes.txt', 'data.json', 'Makefile']) {
    fs.writeFileSync(path.join(dir, other), '');
  }
  if (git) execSync('git init -q', { cwd: dir, stdio: 'pipe' });
  return dir;
}

describe('FileScanner extensions', () => {
  let dirs: string[] = [];
  beforeEach(() => {
    jest.spyOn(Logger, 'warn').mockImplementation();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    dirs = [];
  });

  it('supported extensions are exactly the grammar catalog extensions', () => {
    expect([...FileScanner.supportedExtensions()].sort()).toEqual(catalogExts());
    expect([...FileScanner.supportedExtensions()].sort()).toEqual([...knownExtensions()].sort());
  });

  it.each([
    ['git repo (git ls-files)', true],
    ['non-git fallback (glob)', false],
  ])('%s: discovers one file per catalog extension and nothing else', (_label, git) => {
    const dir = makeRepo(git);
    dirs.push(dir);
    const found = new FileScanner(dir).scan();
    expect(found.map(f => path.extname(f)).sort()).toEqual(catalogExts());
  });

  it('includes languages beyond the original hard-coded set', () => {
    for (const ext of ['.kt', '.swift', '.rb', '.cs', '.scala', '.ex', '.hs', '.sh']) {
      expect(FileScanner.supportedExtensions()).toContain(ext);
    }
  });
});
