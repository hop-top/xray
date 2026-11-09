/**
 * Regression — mergeConfig must forward CLI `--preset` and `--lens`
 * values into the merged options object even when a config file is
 * loaded, and a lens overlay must deep-merge `features` the same way
 * `mergeScopeWithBase` does.
 *
 * Pinning both PR #17 review findings so the rename PR actually
 * delivers working --preset and --lens when users have config files.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig, mergeConfig, mergeScopeWithBase, resolveConfigPaths } from '../../src/lib/config';
import type { XrayConfig } from '../../src/types/xray-config';
import { UsageError } from '../../src/lib/error/types';

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

  it('still forwards preset when config is null', () => {
    const merged = mergeConfig(null, { preset: ['insights'] });
    expect(merged.preset).toEqual(['insights']);
  });
});

describe('mergeConfig — path and detect forwarding', () => {
  it('leaves merged.path empty when neither CLI nor config set paths (keeps auto-detect eligible)', () => {
    const merged = mergeConfig({ telemetry: { enabled: false } } as XrayConfig, {});
    expect(merged.path).toEqual([]);
  });

  it('prefers config paths over the empty default', () => {
    const merged = mergeConfig({ paths: ['./src'] }, {});
    expect(merged.path).toEqual(['./src']);
  });

  it('forwards --detect so it still works when a config file is loaded', () => {
    const merged = mergeConfig({ paths: ['./src'] }, { detect: true });
    expect(merged.detect).toBe(true);
  });

  it('defaults merged.detect to false', () => {
    expect(mergeConfig({ paths: ['./src'] }, {}).detect).toBe(false);
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

describe('mergeConfig — extension contract forwarding', () => {
  it('forwards extension config into merged options', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      extensions: {
        glossary: {
          enabled: true,
          threshold: 0.8,
          hints: ['terms'],
          enabledSurfaces: {
            detect: true,
          },
        },
      },
    };

    const merged = mergeConfig(config, {});
    expect(merged.extensions.glossary).toEqual(config.extensions?.glossary);
  });

  it('deep-merges CLI extension overrides on top of config extensions', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      extensions: {
        glossary: {
          enabled: true,
          threshold: 0.7,
          hints: ['base'],
          enabledSurfaces: {
            detect: true,
          },
        },
      },
    };

    const merged = mergeConfig(config, {
      extensions: {
        glossary: {
          threshold: 0.9,
          hints: ['runtime'],
          enabledSurfaces: {
            export: true,
          },
        },
      },
    });

    expect(merged.extensions.glossary).toEqual({
      enabled: true,
      threshold: 0.9,
      hints: ['base', 'runtime'],
      enabledSurfaces: {
        detect: true,
        export: true,
      },
    });
  });

  it('deduplicates merged hints when override repeats a base hint', () => {
    const config: XrayConfig = {
      paths: ['./src'],
      extensions: {
        glossary: {
          hints: ['terms'],
        },
      },
    };

    const merged = mergeConfig(config, {
      extensions: {
        glossary: {
          hints: ['terms', 'definitions'],
        },
      },
    });

    expect(merged.extensions.glossary.hints).toEqual(['terms', 'definitions']);
  });

  it('deep-merges scope extension overlays without dropping base fields', () => {
    const baseConfig: XrayConfig = {
      paths: ['./src'],
      extensions: {
        glossary: {
          enabled: true,
          threshold: 0.8,
          hints: ['terms'],
          enabledSurfaces: {
            detect: true,
          },
        },
      },
    };

    const merged = mergeScopeWithBase(baseConfig, {
      extensions: {
        glossary: {
          enabledSurfaces: {
            export: true,
          },
        },
      },
    });

    expect(merged.extensions?.glossary).toEqual({
      enabled: true,
      threshold: 0.8,
      hints: ['terms'],
      enabledSurfaces: {
        detect: true,
        export: true,
      },
    });
  });
});

describe('mergeConfig — no config file', () => {
  it('resolves --no-chunk to chunked:false', () => {
    expect(mergeConfig(null, { chunk: false }).chunked).toBe(false);
  });

  it('commander\'s default (chunk: true) does not override config chunked:false', () => {
    expect(mergeConfig({ chunked: false } as any, { chunk: true }).chunked).toBe(false);
    expect(mergeConfig({ chunked: false } as any, {}).chunked).toBe(false);
    expect(mergeConfig({ chunked: true } as any, { chunk: false }).chunked).toBe(false);
  });

  it('defaults to chunked output', () => {
    expect(mergeConfig(null, {}).chunked).toBe(true);
  });
});

describe('mergeConfig — unknown lens', () => {
  it('throws UsageError (exit 2) listing known lenses', () => {
    const config: XrayConfig = { paths: ['./src'], lenses: { quick: { limit: 1 }, deep: { limit: 2 } } };
    expect(() => mergeConfig(config, {}, 'nope')).toThrow(UsageError);
    expect(() => mergeConfig(config, {}, 'nope')).toThrow(/Unknown lens "nope".*known lenses: quick, deep/);
  });

  it('does not resolve inherited object keys as lenses', () => {
    const config: XrayConfig = { paths: ['./src'], lenses: { quick: { limit: 1 } } };
    expect(() => mergeConfig(config, {}, 'toString')).toThrow(UsageError);
  });

  it('throws UsageError when no config is loaded', () => {
    try {
      mergeConfig(null, {}, 'quick');
      throw new Error('expected throw');
    } catch (err: any) {
      expect(err).toBeInstanceOf(UsageError);
      expect(err.exitCode).toBe(2);
    }
  });
});

describe('resolveConfigPaths / loadConfig resolvePaths', () => {
  it('resolves relative paths, output, lens + scope paths against the file dir; keeps absolute', () => {
    const cfg: XrayConfig = {
      paths: ['./src', '/abs/x'],
      output: 'docs/map.txt',
      lenses: { quick: { paths: ['lib'] }, bare: { limit: 1 } },
      scopes: { api: { paths: ['../api'] } },
    };
    const r = resolveConfigPaths(cfg, '/repo/cfg/.xrayrc.json');
    expect(r.paths).toEqual(['/repo/cfg/src', '/abs/x']);
    expect(r.lenses!.quick.paths).toEqual(['/repo/cfg/lib']);
    expect(r.lenses!.bare).toEqual({ limit: 1 });
    expect(r.scopes!.api.paths).toEqual(['/repo/api']);
    expect(r.output).toBe('/repo/cfg/docs/map.txt');
    expect(cfg.paths).toEqual(['./src', '/abs/x']); // input not mutated
  });

  it('loadConfig keeps file paths verbatim unless resolvePaths (load-modify-save callers)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cfg-raw-'));
    try {
      const file = path.join(dir, 'x.json');
      fs.writeFileSync(file, JSON.stringify({ paths: ['./src'] }));
      expect(loadConfig(file)!.paths).toEqual(['./src']);
      expect(loadConfig(file, undefined, { resolvePaths: true })!.paths).toEqual([path.join(dir, 'src')]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
