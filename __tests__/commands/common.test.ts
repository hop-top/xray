import {
  buildExtensionOverrides,
  createStrategyContext,
  normalizeExtensionOptions,
} from '../../src/commands/common';
import { UsageError } from '../../src/lib/error/types';
import * as path from 'path';

describe('extension runtime overrides', () => {
  const testRoot = path.join(__dirname, '../strategy/fixtures/test-project');

  it('builds extension overrides from repeatable CLI flags', () => {
    const overrides = buildExtensionOverrides({
      extensions: {
        glossary: {
          enabled: true,
          hints: ['base'],
          enabledSurfaces: {
            detect: true,
          },
        },
      },
      disableExtension: ['notes'],
      extensionThreshold: ['glossary=0.9'],
      extensionHint: ['glossary=terms', 'glossary=definitions'],
      enableSurface: ['glossary:export'],
      disableSurface: ['glossary:detect'],
    });

    expect(overrides).toEqual({
      glossary: {
        enabled: true,
        threshold: 0.9,
        hints: ['base', 'terms', 'definitions'],
        enabledSurfaces: {
          detect: false,
          export: true,
        },
      },
      notes: {
        enabled: false,
      },
    });
  });

  it('creates a strategy context with normalized extension config', () => {
    const ctx = createStrategyContext(testRoot, {
      enableExtension: ['glossary'],
      extensionThreshold: ['glossary=0.75'],
      extensionHint: ['glossary=terms'],
      enableSurface: ['glossary:detect'],
    });

    expect(ctx.getExtensionConfig('glossary')).toEqual({
      enabled: true,
      threshold: 0.75,
      hints: ['terms'],
      enabledSurfaces: {
        detect: true,
      },
    });
  });

  it('rejects malformed runtime threshold overrides', () => {
    expect(() =>
      buildExtensionOverrides({
        extensionThreshold: ['glossary=high'],
      })
    ).toThrow('Threshold must be a number.');
  });

  it('rejects extension pair specs with whitespace-only name or value', () => {
    expect(() =>
      buildExtensionOverrides({
        extensionThreshold: ['  =0.9'],
      })
    ).toThrow(UsageError);

    expect(() =>
      buildExtensionOverrides({
        extensionHint: ['glossary= '],
      })
    ).toThrow(UsageError);

    expect(() =>
      buildExtensionOverrides({
        enableSurface: [':detect'],
      })
    ).toThrow(UsageError);
  });

  it('does not double-apply repeatable flags when context is built from normalized options', () => {
    const normalized = normalizeExtensionOptions({
      extensionHint: ['glossary=one', 'glossary=two'],
    });

    const ctx = createStrategyContext(testRoot, normalized);
    const cfg = ctx.getExtensionConfig('glossary');

    expect(cfg?.hints).toEqual(['one', 'two']);
  });

  it('throws UsageError (exit 2) for malformed pairs and bad thresholds', () => {
    expect(() =>
      buildExtensionOverrides({
        extensionThreshold: ['no-separator'],
      })
    ).toThrow(UsageError);

    expect(() =>
      buildExtensionOverrides({
        extensionThreshold: ['glossary=not-a-number'],
      })
    ).toThrow(UsageError);
  });
});
