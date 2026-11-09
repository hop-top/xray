/**
 * resolvePreset — each dispatch branch + error cases.
 */

import * as path from 'path';
import {
  resolvePreset,
  PresetResolutionError,
  assertPresetSpec,
} from '../../../src/lib/plugins/presets/resolve';
import { BUILTIN_PRESETS } from '../../../src/lib/plugins/presets/index';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/presets');

describe('resolvePreset', () => {
  it('resolves each built-in bare name to its factory', async () => {
    for (const name of ['insights', 'onboarding', 'exploration'] as const) {
      const preset = await resolvePreset(name);
      expect(preset).toBe(BUILTIN_PRESETS[name]);
    }
  });

  it('throws with the built-in catalog listed for a bogus bare name', async () => {
    await expect(resolvePreset('bogus-preset')).rejects.toBeInstanceOf(
      PresetResolutionError
    );
    await expect(resolvePreset('bogus-preset')).rejects.toThrow(/insights/);
    await expect(resolvePreset('bogus-preset')).rejects.toThrow(/onboarding/);
    await expect(resolvePreset('bogus-preset')).rejects.toThrow(/exploration/);
  });

  it('loads a relative-path fixture and returns a preset', async () => {
    const spec = path.relative(process.cwd(), path.join(FIXTURES_DIR, 'dummy-preset.js'));
    const prefixed = spec.startsWith('.') ? spec : './' + spec;
    const preset = await resolvePreset(prefixed);
    const plugins = preset({ root: '/tmp/fake' });
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.name).toBe('dummy-fixture');
  });

  it('loads an absolute-path fixture and returns a preset', async () => {
    const absolute = path.join(FIXTURES_DIR, 'dummy-preset.js');
    const preset = await resolvePreset(absolute);
    const plugins = preset({ root: '/tmp/fake' });
    expect(plugins[0]!.name).toBe('dummy-fixture');
  });

  it('rejects a module that does not export a function', async () => {
    const absolute = path.join(FIXTURES_DIR, 'not-a-function.js');
    await expect(resolvePreset(absolute)).rejects.toThrow(
      /does not export a function/
    );
  });

  it('rejects a non-existent relative path with the resolved absolute path in the message', async () => {
    const spec = './__tests__/fixtures/presets/does-not-exist.js';
    try {
      await resolvePreset(spec);
      fail('expected resolvePreset to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PresetResolutionError);
      const pre = err as PresetResolutionError;
      expect(pre.message).toContain('does-not-exist.js');
      expect(pre.resolvedPath).toBeDefined();
      expect(path.isAbsolute(pre.resolvedPath!)).toBe(true);
    }
  });

  it('rejects an empty spec string', async () => {
    await expect(resolvePreset('')).rejects.toBeInstanceOf(PresetResolutionError);
  });

  it('treats @scope/pkg as a package form (fails to load without the package installed)', async () => {
    // We cannot actually install a fake scoped package here; assert
    // that the resolver reaches the package-import branch and fails
    // there with a PresetResolutionError (not the unknown-preset branch).
    await expect(
      resolvePreset('@nonexistent-scope/definitely-not-a-real-package')
    ).rejects.toMatchObject({
      name: 'PresetResolutionError',
      message: expect.stringMatching(/npm package/),
    });
  });

  it('classifies failures: unknown name usage (2), missing path/package not-found (3)', async () => {
    await expect(resolvePreset('bogus')).rejects.toMatchObject({ exitCode: 2, code: 'USAGE' });
    await expect(resolvePreset('./does-not-exist.js')).rejects.toMatchObject({ exitCode: 3, code: 'NOT_FOUND' });
    await expect(resolvePreset('@scope/not-installed-xyz')).rejects.toMatchObject({ exitCode: 3, code: 'NOT_FOUND' });
  });

  it('suggests the nearest built-in for a typo', async () => {
    await expect(resolvePreset('insight')).rejects.toThrow(/did you mean 'insights'/);
  });

  it('assertPresetSpec rejects unknown names without loading, passes paths and packages', () => {
    expect(() => assertPresetSpec('nope')).toThrow(PresetResolutionError);
    expect(() => assertPresetSpec('')).toThrow(PresetResolutionError);
    expect(() => assertPresetSpec('insights')).not.toThrow();
    expect(() => assertPresetSpec('./never-loaded.js')).not.toThrow();
    expect(() => assertPresetSpec('@scope/never-loaded')).not.toThrow();
  });
});
