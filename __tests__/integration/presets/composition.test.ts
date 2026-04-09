/**
 * Integration — composition of two presets via multiple `--preset` flags.
 *
 * Applies `insights` then `onboarding` to the same Xray instance and
 * asserts:
 *   - each plugin name appears exactly once on `xray.plugins()`
 *   - the second `applyPreset` call skipped the plugins already
 *     registered by the first (idempotency via `useIfAbsent`)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../../src/lib/xray';
import {
  applyPreset,
  resolvePreset,
} from '../../../src/lib/plugins/presets';

describe('preset composition — insights + onboarding', () => {
  const fixtureDir = path.resolve(__dirname, '../../fixtures/presets/sample');
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-presets-compose-'));
  });

  afterAll(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('composes two presets idempotently; each plugin registered once', async () => {
    const xray = new Xray({
      path: fixtureDir,
      cachePath: path.join(tmpDir, '.xray_cache_compose.db'),
      chunked: true,
    });

    const insights = await resolvePreset('insights');
    const onboarding = await resolvePreset('onboarding');

    const r1 = await applyPreset(xray as any, insights, { root: fixtureDir }, {
      presetName: 'insights',
    });
    const r2 = await applyPreset(xray as any, onboarding, { root: fixtureDir }, {
      presetName: 'onboarding',
    });

    // First call: insights registered all four.
    expect(r1.applied.sort()).toEqual([
      'clustering',
      'confidence-enricher',
      'question-generator',
      'surprise-analyzer',
    ]);
    expect(r1.skipped).toEqual([]);

    // Second call: onboarding's three plugins overlap entirely with insights.
    expect(r2.applied).toEqual([]);
    expect(r2.skipped.sort()).toEqual([
      'clustering',
      'confidence-enricher',
      'question-generator',
    ]);

    // Each plugin name appears exactly once on the host.
    const names = xray.plugins().map((p) => p.name).sort();
    const unique = Array.from(new Set(names));
    expect(names).toEqual(unique);
    expect(names).toEqual([
      'clustering',
      'confidence-enricher',
      'question-generator',
      'surprise-analyzer',
    ]);
  }, 30_000);
});
