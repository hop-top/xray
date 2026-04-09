/**
 * Regression — two CLI flags were renamed in one atomic cut:
 *
 *   1. Old `--preset <name>` (config-file option overlay) is now
 *      `--lens <name>`. Config key `presets:` is now `lenses:`.
 *   2. Old `--use <spec>` (plugin bundle loader) is now
 *      `--preset <spec>`, repeatable. The name now matches the
 *      internal `Preset` / `BUILTIN_PRESETS` / `preset:applied`
 *      terminology.
 *
 * No backward compatibility — the old `--preset` (overlay) and
 * `--use` (plugin) forms are entirely removed. This test pins both
 * renames so any accidental reintroduction surfaces immediately.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { addCommonOptions } from '../../src/commands/common';

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('--preset → --lens and --use → --preset renames', () => {
  describe('commander registration', () => {
    let cmd: Command;
    beforeEach(() => {
      cmd = new Command();
      addCommonOptions(cmd);
    });

    it('registers --lens <name> for the config-file overlay', () => {
      const opt = cmd.options.find((o) => o.long === '--lens');
      expect(opt).toBeDefined();
      expect(opt!.description).toMatch(/lens/i);
      // Lens is a singular string — not repeatable.
      expect(Array.isArray(opt!.defaultValue)).toBe(false);
    });

    it('registers --preset <spec> for the plugin bundle loader', () => {
      const opt = cmd.options.find((o) => o.long === '--preset');
      expect(opt).toBeDefined();
      expect(opt!.description).toMatch(/plugin preset/i);
      // Plugin preset is repeatable — default is an empty array.
      expect(Array.isArray(opt!.defaultValue)).toBe(true);
    });

    it('does NOT register the old --use option', () => {
      const opt = cmd.options.find((o) => o.long === '--use');
      expect(opt).toBeUndefined();
    });
  });

  describe('source code — no stale --use references', () => {
    const USE_ALLOWLIST = [
      /^src\/lib\/xray\.ts$/,            // xray.use / useIfAbsent methods
      /^src\/lib\/events\/plugin\.ts$/,  // applyIfAbsent docstring
      /^src\/lib\/plugins\/presets\/apply\.ts$/, // useIfAbsent call site
    ];

    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'coverage' ||
          entry.name.startsWith('.')
        ) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(ts|js)$/.test(entry.name)) out.push(full);
      }
      return out;
    }

    it('no src file references the old --use CLI flag form', () => {
      const offenders: string[] = [];
      for (const file of walk(path.join(REPO_ROOT, 'src'))) {
        // Normalize to POSIX separators so the allowlist regexes
        // (written with forward slashes) work on Windows too.
        const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
        if (USE_ALLOWLIST.some((re) => re.test(rel))) continue;
        const content = fs.readFileSync(file, 'utf-8');
        if (/--use\b/.test(content)) offenders.push(rel);
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('source code — no stale --preset overlay or presets: config key', () => {
    // Files allowed to contain the literal "presets" because they
    // document / implement the (renamed-in) `--preset` plugin bundle
    // system — NOT the old config-file overlay.
    const PLUGIN_PRESET_ALLOWLIST = [
      /^src\/lib\/plugins\/presets\//,
      /^src\/lib\/plugins\/question-generator\.ts$/,
      /^src\/lib\/plugins\/surprise-analyzer\.ts$/,
      /^src\/lib\/events\/plugin\.ts$/,
      /^src\/lib\/events\/types\.ts$/,
      /^src\/commands\/generate\.ts$/,
      /^src\/commands\/common\.ts$/,
      /^src\/types\/command-options\.ts$/,
      /^__tests__\/plugins\/presets\//,
      /^__tests__\/integration\/presets\//,
      /^__tests__\/fixtures\/presets\//,
      /^__tests__\/commands\/cli-boot\.test\.ts$/,
      /^__tests__\/commands\/lens-rename\.test\.ts$/,
      /^docs\/user\/presets\.md$/,
      /^docs\/stories\/US-000[345]-/,
      /^CHANGELOG\.md$/,
      /^README\.md$/,
    ];

    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === 'coverage' ||
          entry.name.startsWith('.')
        ) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(ts|js|json|md)$/.test(entry.name)) out.push(full);
      }
      return out;
    }

    it('no source/test/doc file declares a "presets:" config-file key', () => {
      const roots = ['src', '__tests__', 'docs', 'README.md'];
      const offenders: string[] = [];
      for (const root of roots) {
        const rootPath = path.join(REPO_ROOT, root);
        if (!fs.existsSync(rootPath)) continue;
        const files = fs.statSync(rootPath).isDirectory()
          ? walk(rootPath)
          : [rootPath];
        for (const file of files) {
          // Normalize to POSIX separators so the allowlist regexes
          // (written with forward slashes) work on Windows too.
          const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
          if (PLUGIN_PRESET_ALLOWLIST.some((re) => re.test(rel))) continue;
          const content = fs.readFileSync(file, 'utf-8');
          // The config-key form: `"presets":` JSON or `presets?:`
          // TypeScript or `presets:` YAML/JS at line start.
          if (/(^|\n)\s*"?presets"?\s*\??\s*:/.test(content)) {
            offenders.push(rel);
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('config types — XrayConfig uses lenses key, CliOptions uses lens', () => {
    it('src/types/xray-config.ts declares lenses? and not presets?', () => {
      const content = fs.readFileSync(
        path.join(REPO_ROOT, 'src/types/xray-config.ts'),
        'utf-8'
      );
      expect(content).toMatch(/lenses\?\s*:/);
      expect(content).not.toMatch(/presets\?\s*:/);
    });

    it('src/types/cli-options.ts declares lens? and no preset? or use?', () => {
      const content = fs.readFileSync(
        path.join(REPO_ROOT, 'src/types/cli-options.ts'),
        'utf-8'
      );
      expect(content).toMatch(/^\s*lens\?\s*:/m);
      expect(content).not.toMatch(/^\s*preset\?\s*:/m);
      expect(content).not.toMatch(/^\s*use\?\s*:/m);
    });

    it('src/types/command-options.ts has lens? string and preset? string[]', () => {
      const content = fs.readFileSync(
        path.join(REPO_ROOT, 'src/types/command-options.ts'),
        'utf-8'
      );
      expect(content).toMatch(/^\s*lens\?\s*:\s*string;/m);
      expect(content).toMatch(/^\s*preset\?\s*:\s*string\[\];/m);
      expect(content).not.toMatch(/^\s*use\?\s*:/m);
    });
  });

  describe('mergeConfig signature', () => {
    it('src/lib/config.ts mergeConfig uses the lens parameter name', () => {
      const content = fs.readFileSync(
        path.join(REPO_ROOT, 'src/lib/config.ts'),
        'utf-8'
      );
      expect(content).toMatch(
        /mergeConfig\([^)]*lens\?\s*:\s*string[^)]*\)/
      );
      expect(content).not.toMatch(
        /mergeConfig\([^)]*preset\?\s*:\s*string[^)]*\)/
      );
    });
  });
});
