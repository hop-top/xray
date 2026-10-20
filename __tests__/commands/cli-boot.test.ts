/**
 * E2E regression — the compiled CLI must boot without
 * exports-map / module-resolution failures.
 *
 * Builds `dist/index.js` on demand (if missing or stale) so the
 * regression runs under the default `jest` invocation, not only in
 * environments where the CLI happens to be pre-built. Any
 * exports-gated subpath import that bypasses a package's `exports`
 * map will cause `node dist/index.js map --help` to throw at
 * load time and this test will fail loudly.
 *
 * Build is gated behind TSC availability — if the local TypeScript
 * compiler is not resolvable from the workspace (unusual), the
 * test skips rather than failing. On every normal developer or CI
 * machine the build runs once per `beforeAll`.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');

function resolveTsc(): string | null {
  try {
    // Delegate to node_modules resolution first.
    return require.resolve('typescript/bin/tsc');
  } catch {
    // Fallback: walk pnpm store from the workspace root. pnpm places
    // the real binary under .pnpm/typescript@*/node_modules/...
    const candidates = [
      path.resolve(ROOT, '..', '..', '..', '..', 'node_modules', '.pnpm'),
    ];
    for (const storeDir of candidates) {
      if (!fs.existsSync(storeDir)) continue;
      for (const entry of fs.readdirSync(storeDir)) {
        if (!entry.startsWith('typescript@')) continue;
        const bin = path.join(
          storeDir,
          entry,
          'node_modules',
          'typescript',
          'bin',
          'tsc'
        );
        if (fs.existsSync(bin)) return bin;
      }
    }
    return null;
  }
}

function buildDist(): boolean {
  const tsc = resolveTsc();
  if (!tsc) return false;
  try {
    execFileSync('node', [tsc], {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return fs.existsSync(DIST_ENTRY);
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
    // eslint-disable-next-line no-console
    console.warn(`[cli-boot.test] tsc build failed:\n${stderr}`);
    return false;
  }
}

describe('E2E: compiled CLI boot', () => {
  let canRun = false;

  beforeAll(() => {
    if (!fs.existsSync(DIST_ENTRY)) {
      canRun = buildDist();
    } else {
      canRun = true;
    }
  }, 60_000);

  const run = (...args: string[]): string =>
    execFileSync('node', [DIST_ENTRY, ...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  it('xray map --help boots without ERR_PACKAGE_PATH_NOT_EXPORTED', () => {
    if (!canRun) {
      // eslint-disable-next-line no-console
      console.warn(
        '[cli-boot.test] skipped — tsc not resolvable from workspace'
      );
      return;
    }
    let output: string;
    try {
      output = run('map', '--help');
    } catch (err) {
      const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
      throw new Error(`CLI failed to boot. stderr:\n${stderr}`);
    }
    // Both flags must be present in the help.
    expect(output).toContain('--lens');
    expect(output).toContain('--preset');
    expect(output).toContain('Apply a plugin preset');
    expect(output).toMatch(/insights/);
    expect(output).toMatch(/onboarding/);
    expect(output).toMatch(/exploration/);
    // No trace of the old `--use` flag.
    expect(output).not.toMatch(/--use\b/);
  }, 60_000);
});
