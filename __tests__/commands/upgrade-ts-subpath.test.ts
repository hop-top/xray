/**
 * Regression for the `@hop/upgrade-ts` subpath import bug.
 *
 * Before this fix, `src/commands/registration/core.ts` imported
 * `@hop/upgrade-ts/dist/commander`. TypeScript's file-based
 * resolution accepted it, but Node's runtime `exports` map in
 * `@hop/upgrade-ts/package.json` only whitelists `.` and
 * `./commander`. Any attempt to `require('./dist/commander')` at
 * runtime threw `ERR_PACKAGE_PATH_NOT_EXPORTED`, breaking the built
 * CLI entirely (`node dist/index.js` could not even print --help).
 *
 * These assertions nail the correct subpath and catch any future
 * regression that reintroduces the raw `dist/` path.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('@hop/upgrade-ts subpath import', () => {
  const srcFile = path.resolve(
    __dirname,
    '../../src/commands/registration/core.ts'
  );

  it('src/commands/registration/core.ts does NOT use a value import from @hop/upgrade-ts/dist/*', () => {
    // A type-only import (`import type { ... } from '...dist/...'`)
    // is acceptable because it is erased at compile time and never
    // reaches the runtime resolver. What we forbid is a VALUE
    // import from the raw dist path, which would hit Node's
    // exports-map guard at runtime.
    const content = fs.readFileSync(srcFile, 'utf-8');
    expect(content).not.toMatch(
      /^import\s+(?!type\s)[^;]*from\s+['"]@hop\/upgrade-ts\/dist\//m
    );
    expect(content).not.toMatch(
      /require\s*\(\s*['"]@hop\/upgrade-ts\/dist\//
    );
  });

  it('src/commands/registration/core.ts loads the commander subpath at runtime via the exports map', () => {
    const content = fs.readFileSync(srcFile, 'utf-8');
    // Either a plain VALUE import `from '@hop/upgrade-ts/commander'`
    // or a `require('@hop/upgrade-ts/commander')` call is
    // acceptable — both honour the package's `exports` map. A
    // type-only `import type {} from '@hop/upgrade-ts/commander'`
    // does NOT satisfy the invariant because it is erased at
    // compile time and never reaches the runtime resolver.
    const hasValueImport =
      /^import\s+(?!type\s)[^;]*from\s+['"]@hop\/upgrade-ts\/commander['"]/m.test(
        content
      );
    const hasRequire =
      /require\s*\(\s*['"]@hop\/upgrade-ts\/commander['"]\s*\)/.test(content);
    expect(hasValueImport || hasRequire).toBe(true);
  });

  it('the resolved package exposes ./commander in its exports map', () => {
    // The package's own `exports` map does NOT whitelist
    // `./package.json`, so require.resolve on the manifest fails.
    // Walk up from the commander entry point instead: Node's
    // resolver CAN resolve `./commander`, and the manifest sits in
    // the same package directory.
    const commanderEntry = require.resolve('@hop/upgrade-ts/commander');
    let dir = path.dirname(commanderEntry);
    let pkgPath: string | undefined;
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const manifest = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (manifest.name === '@hop/upgrade-ts') {
          pkgPath = candidate;
          break;
        }
      }
      dir = path.dirname(dir);
    }
    expect(pkgPath).toBeDefined();
    const pkg = JSON.parse(fs.readFileSync(pkgPath!, 'utf-8'));
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports['./commander']).toBeDefined();
    // And the raw internal path must NOT be exported — any future
    // attempt to rely on it is a regression.
    expect(pkg.exports['./dist/commander']).toBeUndefined();
  });

  it('require("@hop/upgrade-ts/commander") resolves without ERR_PACKAGE_PATH_NOT_EXPORTED', () => {
    const mod = require('@hop/upgrade-ts/commander');
    expect(typeof mod.createUpgradeCommand).toBe('function');
  });
});
