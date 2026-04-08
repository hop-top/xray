/**
 * exploration preset — membership + US-0005 no-questions invariant.
 */

import { createExplorationPreset } from '../../../src/lib/plugins/presets/exploration';
import type { PresetContext } from '../../../src/lib/plugins/presets/types';

const ctx: PresetContext = { root: '/tmp/fake' };

describe('createExplorationPreset', () => {
  it('returns two plugins: confidence + surprise only', () => {
    const plugins = createExplorationPreset(ctx);
    expect(plugins.map((p) => p.name)).toEqual([
      'confidence-enricher',
      'surprise-analyzer',
    ]);
  });

  it('does NOT include clustering (US-0005 invariant)', () => {
    const plugins = createExplorationPreset(ctx);
    expect(plugins.map((p) => p.name)).not.toContain('clustering');
  });

  it('does NOT include question-generator (US-0005 invariant)', () => {
    const plugins = createExplorationPreset(ctx);
    expect(plugins.map((p) => p.name)).not.toContain('question-generator');
  });

  it('returns a fresh array of fresh instances on every call', () => {
    const first = createExplorationPreset(ctx);
    const second = createExplorationPreset(ctx);
    expect(first).not.toBe(second);
  });
});
