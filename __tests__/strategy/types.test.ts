import {
  normalizeDetectedStrategy,
  type ExtensionEvidence,
} from '../../src/lib/strategy/types';

describe('normalizeDetectedStrategy', () => {
  const strategy = {
    name: 'glossary',
    version: '0.1.0',
  };

  it('normalizes boolean detection into a detected strategy record', () => {
    const detected = normalizeDetectedStrategy(strategy as any, true);

    expect(detected).toMatchObject({
      name: 'glossary',
      version: '0.1.0',
      surface: 'strategy',
    });
    expect(detected?.detectedAt).toBeGreaterThan(0);
  });

  it('uses strategy surface for boolean detection results (regression PR #18)', () => {
    const glossary = { name: 'glossary', version: '1', surface: 'glossary' };
    const detected = normalizeDetectedStrategy(glossary as any, true);
    expect(detected?.surface).toBe('glossary');
  });

  it('uses strategy surface when result surface is missing (regression PR #18)', () => {
    const glossary = { name: 'glossary', version: '1', surface: 'glossary' };
    const detected = normalizeDetectedStrategy(glossary as any, { matched: true });
    expect(detected?.surface).toBe('glossary');
  });

  it('returns null for negative detection results', () => {
    expect(normalizeDetectedStrategy(strategy as any, false)).toBeNull();
    expect(
      normalizeDetectedStrategy(strategy as any, { matched: false })
    ).toBeNull();
  });

  it('normalizes object detection results', () => {
    const evidence: ExtensionEvidence[] = [
      { surface: 'file', value: 'glossary.yml' },
    ];
    const detected = normalizeDetectedStrategy(strategy as any, {
      matched: true,
      score: 0.92,
      detectedAt: 1234,
      config: { source: 'docs' },
      evidence,
      surface: 'glossary',
    });

    expect(detected).toEqual({
      name: 'glossary',
      version: '0.1.0',
      score: 0.92,
      detectedAt: 1234,
      config: { source: 'docs' },
      evidence,
      surface: 'glossary',
    });
  });
});
