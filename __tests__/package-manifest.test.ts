/**
 * Published-package manifest guards: license, no consumer-side install
 * scripts, and a resolvable strategy type entry in the real pack list.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

function packFiles(): string[] {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].files.map((f: { path: string }) => f.path);
}

describe('package manifest', () => {
  it('declares the MIT license', () => {
    expect(pkg.license).toBe('MIT');
  });

  it.each(['preinstall', 'install', 'postinstall', 'prepare'])(
    'has no %s script (it would run for, or be reported to, consumers)',
    (name) => {
      expect(pkg.scripts?.[name]).toBeUndefined();
    }
  );

  describe('pack list', () => {
    let files: string[];
    beforeAll(() => {
      files = packFiles();
    });

    it('ships the strategy type entry named by exports', () => {
      const entry = pkg.exports?.['./strategy'];
      expect(entry).toBeDefined();
      for (const target of [entry.types, entry.default]) {
        expect(files).toContain(target.replace(/^\.\//, ''));
      }
    });

    it('ships declarations for every file the strategy types import', () => {
      const dts = (p: string) => p.replace(/^\.\//, '');
      const seen = new Set<string>();
      const walk = (rel: string) => {
        if (seen.has(rel)) return;
        seen.add(rel);
        expect(files).toContain(rel);
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
        for (const m of src.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
          walk(path.posix.join(path.posix.dirname(rel), m[1]) + '.d.ts');
        }
      };
      walk(dts(pkg.exports['./strategy'].types));
    });

    it('ships the bin target, schema and license', () => {
      expect(files).toEqual(expect.arrayContaining(['bin/xray', 'schemas/xray.imports.v1.json', 'LICENSE']));
    });

    it('does not ship the unreferenced bin/cli.js duplicate', () => {
      expect(files).not.toContain('bin/cli.js');
    });
  });
});
