/**
 * Regression — mergeConfig must forward CLI `--preset` and `--lens`
 * values into the merged options object even when a config file is
 * loaded, and a lens overlay must deep-merge `features` the same way
 * `mergeScopeWithBase` does.
 *
 * Pinning both PR #17 review findings so the rename PR actually
 * delivers working --preset and --lens when users have config files.
 */

import { mergeConfig } from '../../src/lib/config';
import type { XrayConfig } from '../../src/types/xray-config';

describe('mergeConfig — plugin preset + lens forwarding', () => {
  it('forwards CLI --preset array into merged options when a config is present', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      limit: 4096,
    };
    const cliOptions = {
      preset: ['insights', './my-preset.js'],
    };
    const merged = mergeConfig(config, cliOptions);
    expect(merged.preset).toEqual(['insights', './my-preset.js']);
  });

  it('defaults merged.preset to [] when the CLI did not pass --preset', () => {
    const config: XrayConfig = { paths: ['./src'] };
    const merged = mergeConfig(config, {});
    expect(merged.preset).toEqual([]);
  });

  it('forwards the resolved lens name into merged.lens', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      lenses: {
        quick: { limit: 2048 },
      },
    };
    const merged = mergeConfig(config, {}, 'quick');
    expect(merged.lens).toBe('quick');
  });

  it('returns cliOptions unchanged when config is null (short-circuit path)', () => {
    const cli = { preset: ['insights'], lens: 'quick' };
    const merged = mergeConfig(null, cli);
    expect(merged).toBe(cli);
  });
});

describe('mergeConfig — lens features deep-merge', () => {
  it('preserves base features not overridden by the lens', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      features: { vars: true, incs: true, docs: false },
      lenses: {
        // Lens only sets `docs`. Base `vars` and `incs` MUST survive.
        detailed: { features: { docs: true } },
      },
    };
    const merged = mergeConfig(config, {}, 'detailed');
    // `with` is the final projected feature list. vars + incs should
    // remain enabled from base, docs flips on via the lens.
    expect(merged.with).toEqual(
      expect.arrayContaining(['vars', 'incs', 'docs'])
    );
    expect(merged.with).not.toContain('cf');
    expect(merged.with).not.toContain('df');
  });

  it('lens feature override wins over base feature with the same name', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      features: { vars: false },
      lenses: {
        detailed: { features: { vars: true } },
      },
    };
    const merged = mergeConfig(config, {}, 'detailed');
    expect(merged.with).toContain('vars');
  });

  it('does not drop base features when lens sets features: {} (empty object)', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      features: { incs: true },
      lenses: {
        empty: { features: {} },
      },
    };
    const merged = mergeConfig(config, {}, 'empty');
    expect(merged.with).toContain('incs');
  });

  it('lens with no features field leaves base features intact', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      features: { vars: true, docs: true },
      lenses: {
        // Lens only changes limit — features should pass through.
        narrow: { limit: 1024 },
      },
    };
    const merged = mergeConfig(config, {}, 'narrow');
    expect(merged.with).toEqual(expect.arrayContaining(['vars', 'docs']));
    expect(merged.limit).toBe('1024');
  });
});
