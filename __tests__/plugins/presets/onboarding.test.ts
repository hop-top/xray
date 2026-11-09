/**
 * onboarding preset — membership + US-0004 no-surprise invariant.
 */

import { createOnboardingPreset } from '../../../src/lib/plugins/presets/onboarding';
import type { PresetContext } from '../../../src/lib/plugins/presets/types';

const ctx: PresetContext = { root: '/tmp/fake' };

describe('createOnboardingPreset', () => {
  it('returns three plugins in the spec-mandated order', () => {
    const plugins = createOnboardingPreset(ctx);
    expect(plugins.map((p) => p.name)).toEqual([
      'confidence-enricher',
      'clustering',
      'question-generator',
    ]);
  });

  it('does NOT include surprise-analyzer (US-0004 invariant)', () => {
    const plugins = createOnboardingPreset(ctx);
    const names = plugins.map((p) => p.name);
    expect(names).not.toContain('surprise-analyzer');
  });

  it('returns a fresh array of fresh instances on every call', () => {
    const first = createOnboardingPreset(ctx);
    const second = createOnboardingPreset(ctx);
    expect(first).not.toBe(second);
    for (let i = 0; i < first.length; i++) {
      expect(first[i]).not.toBe(second[i]);
    }
  });
});
