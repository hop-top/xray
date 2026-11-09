/**
 * insights preset — full bundle membership + order invariants.
 */

import { createInsightsPreset } from '../../../src/lib/plugins/presets/insights';
import type { PresetContext } from '../../../src/lib/plugins/presets/types';

const ctx: PresetContext = { root: '/tmp/fake' };

describe('createInsightsPreset', () => {
  it('returns four plugins in the spec-mandated order', () => {
    const plugins = createInsightsPreset(ctx);
    expect(plugins.map((p) => p.name)).toEqual([
      'confidence-enricher',
      'clustering',
      'surprise-analyzer',
      'question-generator',
    ]);
  });

  it('returns a fresh array of fresh instances on every call', () => {
    const first = createInsightsPreset(ctx);
    const second = createInsightsPreset(ctx);
    expect(first).not.toBe(second);
    for (let i = 0; i < first.length; i++) {
      expect(first[i]).not.toBe(second[i]);
      expect(first[i]!.name).toBe(second[i]!.name);
    }
  });
});
