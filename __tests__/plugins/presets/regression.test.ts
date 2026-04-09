/**
 * Regression tests for PR #15 review comments.
 *
 * Each test pins a specific review finding so it cannot silently
 * regress in a future refactor.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyPreset,
  resolvePreset,
  BUILTIN_PRESET_NAMES,
} from '../../../src/lib/plugins/presets';
import { addCommonOptions } from '../../../src/commands/common';
import { AsyncEventEmitter } from '../../../src/lib/events/async-emitter';
import type { XrayPlugin, XrayLike } from '../../../src/lib/events/plugin';
import { XrayEvents } from '../../../src/lib/events/types';
import { Logger } from '../../../src/lib/logger';
import { Command } from 'commander';

function makeFakeHost() {
  const emitter = new AsyncEventEmitter<XrayEvents>();
  const registered: XrayPlugin[] = [];
  const host = Object.assign(emitter, {
    getLastGraph: () => ({}),
    stash: () => {},
    retrieve: () => [],
    plugins: () => registered.slice(),
    useIfAbsent: async (p: XrayPlugin) => {
      if (registered.some((r) => r.name === p.name)) return;
      await p.apply(host as unknown as XrayLike);
      registered.push(p);
    },
  }) as any;
  return host;
}

function fakePlugin(name: string): XrayPlugin {
  return { name, version: '0.0.0', apply: () => {} };
}

describe('PR #15 review regressions', () => {
  // -----------------------------------------------------------------
  // #1: Windows-portable dynamic import via pathToFileURL
  // -----------------------------------------------------------------
  //
  // Guard: the resolver must load a preset from an absolute path that
  // contains a space — a path that `import(rawPath)` would mangle on
  // Windows and that `import('file://...')` handles correctly after
  // `pathToFileURL` URL-encodes the space. On POSIX this still
  // exercises the `pathToFileURL` code path end-to-end.
  describe('#1 Windows-portable dynamic import (pathToFileURL)', () => {
    let tmpDir: string;
    let fixturePath: string;

    beforeAll(() => {
      // A directory with a space forces URL encoding on any platform.
      tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'xray-preset reg-')
      );
      fixturePath = path.join(tmpDir, 'my-preset.js');
      fs.writeFileSync(
        fixturePath,
        `module.exports = function spacedPreset() {
           return [{ name: 'spaced-noop', version: '0', apply: () => {} }];
         };
         module.exports.default = module.exports;
        `
      );
    });

    afterAll(() => {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('resolves an absolute path containing a space via file:// URL', async () => {
      expect(fixturePath).toMatch(/ /);
      const preset = await resolvePreset(fixturePath);
      const plugins = preset({ root: '/tmp' });
      expect(plugins).toHaveLength(1);
      expect(plugins[0]!.name).toBe('spaced-noop');
    });
  });

  // -----------------------------------------------------------------
  // #2: short-circuit useIfAbsent when plugin is already present
  // -----------------------------------------------------------------
  //
  // Guard: composing two presets that share a plugin MUST NOT call
  // `useIfAbsent` for the duplicate (which would trigger core's
  // `warn`-level duplicate log). Instead the runner records a
  // debug-level skip and continues.
  describe('#2 composition does not emit warn on duplicate plugin', () => {
    it('never calls useIfAbsent for an already-registered plugin', async () => {
      const host = makeFakeHost();
      const useSpy = jest.spyOn(host, 'useIfAbsent');
      const warnSpy = jest.spyOn(Logger, 'warn').mockImplementation(() => {});

      const shared = fakePlugin('shared');
      const first = () => [shared, fakePlugin('only-first')];
      const second = () => [fakePlugin('shared'), fakePlugin('only-second')];

      await applyPreset(host, first, { root: '/tmp' }, { presetName: 'first' });
      await applyPreset(host, second, { root: '/tmp' }, { presetName: 'second' });

      // 3 distinct useIfAbsent invocations — the duplicate `shared`
      // plugin in the second preset is short-circuited before the
      // call site, so the core's `applyIfAbsent` duplicate-warn path
      // never fires.
      expect(useSpy).toHaveBeenCalledTimes(3);
      const callNames = useSpy.mock.calls.map((c) => (c[0] as XrayPlugin).name);
      expect(callNames).toEqual([
        'shared',
        'only-first',
        'only-second',
      ]);

      // No warn emitted from the runner for composition (it reserves
      // warn for real apply() failures).
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
      const runnerWarns = warnCalls.filter((m) => m.includes('[presets]'));
      expect(runnerWarns).toHaveLength(0);

      warnSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------
  // #3: CLI help text derived from BUILTIN_PRESET_NAMES (no hardcoded
  //     drift between the constant and the commander option string).
  // -----------------------------------------------------------------
  describe('#3 CLI --preset help text sourced from BUILTIN_PRESET_NAMES', () => {
    it('help text lists every built-in preset name from the constant', () => {
      const cmd = new Command();
      addCommonOptions(cmd);
      const presetOption = cmd.options.find((o) => o.long === '--preset');
      expect(presetOption).toBeDefined();
      const desc = presetOption!.description;
      for (const name of BUILTIN_PRESET_NAMES) {
        expect(desc).toContain(name);
      }
    });
  });

  // -----------------------------------------------------------------
  // #4/#5: docs frontmatter + resolver header comment drift
  // -----------------------------------------------------------------
  describe('#4 docs/user/presets.md uses YAML frontmatter', () => {
    it('starts with a YAML frontmatter block, not a bare author line', () => {
      const docPath = path.resolve(__dirname, '../../../docs/user/presets.md');
      const content = fs.readFileSync(docPath, 'utf-8');
      expect(content.startsWith('---\n')).toBe(true);
      expect(content).toMatch(/title:\s*"[^"]+"/);
      expect(content).toMatch(/author:\s*\w+/);
      expect(content).toMatch(/track:\s*xray-presets-init/);
      // The bare "author: $USER" under the H1 must NOT reappear.
      expect(content).not.toMatch(/^# Plugin presets\n\nauthor: \$USER/m);
    });
  });

  describe('#5 resolver header comment matches impl (first-function semantics)', () => {
    it('comment no longer claims a named export must match the spec', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../../../src/lib/plugins/presets/resolve.ts'),
        'utf-8'
      );
      expect(src).not.toContain('named export matching the spec');
      expect(src).toContain('at least one named export that is a function');
    });
  });
});
