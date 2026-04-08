/**
 * Integration — custom preset loading from a local file + error cases.
 *
 * Exercises the same resolver/runner pair the CLI uses, without going
 * through commander. Covers:
 *   (a) local-file fixture resolves and registers a no-op plugin
 *   (b) bogus bare name throws with the built-in catalog in the message
 *   (c) non-existent local path throws with the resolved absolute path
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../../src/lib/xray';
import {
  applyPreset,
  resolvePreset,
  PresetResolutionError,
} from '../../../src/lib/plugins/presets';

describe('custom preset loading', () => {
  const fixtureDir = path.resolve(__dirname, '../../fixtures/presets/sample');
  const customPresetFile = path.resolve(
    __dirname,
    '../../fixtures/presets/dummy-preset.js'
  );
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-presets-custom-'));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('loads a local-file fixture preset and registers its plugin', async () => {
    const xray = new Xray({
      path: fixtureDir,
      cachePath: path.join(tmpDir, '.xray_cache_custom.db'),
      chunked: true,
    });

    const preset = await resolvePreset(customPresetFile);
    const result = await applyPreset(xray as any, preset, { root: fixtureDir }, {
      presetName: customPresetFile,
    });

    expect(result.applied).toEqual(['dummy-fixture']);
    expect(result.errored).toEqual([]);
    expect(xray.plugins().map((p) => p.name)).toContain('dummy-fixture');
  });

  it('rejects "bogus-preset" with the built-in catalog listed', async () => {
    try {
      await resolvePreset('bogus-preset');
      fail('expected resolvePreset to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PresetResolutionError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/insights/);
      expect(msg).toMatch(/onboarding/);
      expect(msg).toMatch(/exploration/);
    }
  });

  it('rejects a non-existent local path with the resolved absolute path', async () => {
    const spec = './__tests__/fixtures/presets/does-not-exist.js';
    try {
      await resolvePreset(spec);
      fail('expected resolvePreset to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PresetResolutionError);
      const pre = err as PresetResolutionError;
      expect(pre.resolvedPath).toBeDefined();
      expect(path.isAbsolute(pre.resolvedPath!)).toBe(true);
      expect(pre.message).toContain('does-not-exist.js');
    }
  });
});
