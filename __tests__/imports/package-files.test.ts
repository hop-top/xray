import { execFileSync } from 'child_process';
import * as path from 'path';

// Consumers validate `xray imports` output against the shipped schema, so it
// must be in the published tarball. `npm pack --dry-run` is offline.

const ROOT = path.resolve(__dirname, '..', '..');

describe('published package', () => {
  it('includes schemas/xray.imports.v1.json', () => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [pkg] = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
    expect(pkg.files.map(f => f.path)).toContain('schemas/xray.imports.v1.json');
  }, 60_000);
});
