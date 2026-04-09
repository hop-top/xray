import {
  buildExtensionOverrides,
  createStrategyContext,
} from '../../src/commands/common';
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
});
