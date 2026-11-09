/**
 * applyPreset — idempotency, error isolation, timings, telemetry.
 *
 * Uses a minimal fake XrayLike host that mirrors the narrow surface
 * the runner consumes: `plugins()`, `useIfAbsent`, and the async
 * event emitter contract for `preset:applied`.
 */

import { AsyncEventEmitter } from '../../../src/lib/events/async-emitter';
import { XrayEvents } from '../../../src/lib/events/types';
import type { XrayPlugin, XrayLike } from '../../../src/lib/events/plugin';
import { applyPreset } from '../../../src/lib/plugins/presets/apply';
import type { Preset, PresetContext } from '../../../src/lib/plugins/presets/types';

interface FakeHost extends XrayLike {
  useIfAbsent: (p: XrayPlugin) => Promise<unknown>;
  plugins: () => XrayPlugin[];
  _registered: XrayPlugin[];
}

function makeFakeHost(): FakeHost {
  const emitter = new AsyncEventEmitter<XrayEvents>();
  const registered: XrayPlugin[] = [];
  const host = Object.assign(emitter, {
    _registered: registered,
    getLastGraph: () => ({}),
    stash: () => {},
    retrieve: () => [],
    plugins: () => registered.slice(),
    useIfAbsent: async (p: XrayPlugin) => {
      if (registered.some((r) => r.name === p.name)) return;
      await p.apply(host as unknown as XrayLike);
      registered.push(p);
    },
  }) as unknown as FakeHost;
  return host;
}

function fakePlugin(name: string): XrayPlugin {
  return {
    name,
    version: '0.0.0',
    apply: () => {},
  };
}

function throwingPlugin(name: string, message: string): XrayPlugin {
  return {
    name,
    version: '0.0.0',
    apply: () => {
      throw new Error(message);
    },
  };
}

const ctx: PresetContext = { root: '/tmp/fake' };

describe('applyPreset', () => {
  it('returns all-empty arrays for an empty preset', async () => {
    const host = makeFakeHost();
    const preset: Preset = () => [];
    const result = await applyPreset(host, preset, ctx, { presetName: 'empty' });
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.errored).toEqual([]);
    expect(result.timings).toEqual({});
  });

  it('applies every plugin in a three-plugin preset', async () => {
    const host = makeFakeHost();
    const preset: Preset = () => [fakePlugin('a'), fakePlugin('b'), fakePlugin('c')];
    const result = await applyPreset(host, preset, ctx, { presetName: 'abc' });
    expect(result.applied).toEqual(['a', 'b', 'c']);
    expect(result.skipped).toEqual([]);
    expect(result.errored).toEqual([]);
    expect(Object.keys(result.timings).sort()).toEqual(['a', 'b', 'c']);
  });

  it('re-applying the same preset skips all plugins on the second call', async () => {
    const host = makeFakeHost();
    const preset: Preset = () => [fakePlugin('a'), fakePlugin('b'), fakePlugin('c')];
    await applyPreset(host, preset, ctx, { presetName: 'abc' });
    const second = await applyPreset(host, preset, ctx, { presetName: 'abc' });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['a', 'b', 'c']);
    expect(second.errored).toEqual([]);
  });

  it('composes two presets that share a plugin name without double-register', async () => {
    const host = makeFakeHost();
    const first: Preset = () => [fakePlugin('shared'), fakePlugin('only-first')];
    const second: Preset = () => [fakePlugin('shared'), fakePlugin('only-second')];
    const r1 = await applyPreset(host, first, ctx, { presetName: 'first' });
    const r2 = await applyPreset(host, second, ctx, { presetName: 'second' });
    expect(r1.applied.sort()).toEqual(['only-first', 'shared']);
    expect(r2.applied).toEqual(['only-second']);
    expect(r2.skipped).toEqual(['shared']);
    // Shared plugin registered exactly once on the host.
    const names = host.plugins().map((p) => p.name).sort();
    expect(names).toEqual(['only-first', 'only-second', 'shared']);
  });

  it('isolates per-plugin apply() errors without aborting the loop', async () => {
    const host = makeFakeHost();
    const preset: Preset = () => [
      fakePlugin('good-1'),
      throwingPlugin('boom', 'kaboom'),
      fakePlugin('good-2'),
    ];
    const result = await applyPreset(host, preset, ctx, { presetName: 'mixed' });
    expect(result.applied).toEqual(['good-1', 'good-2']);
    expect(result.errored.map((e) => e.name)).toEqual(['boom']);
    expect(result.errored[0]!.error.message).toBe('kaboom');
    expect(Object.keys(result.timings).sort()).toEqual([
      'boom',
      'good-1',
      'good-2',
    ]);
  });

  it('records finite, non-negative timings for every plugin in the preset', async () => {
    const host = makeFakeHost();
    const preset: Preset = () => [fakePlugin('a'), fakePlugin('b')];
    const result = await applyPreset(host, preset, ctx, { presetName: 'ab' });
    for (const [, ms] of Object.entries(result.timings)) {
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('emits preset:applied exactly once with the resolved name and payload', async () => {
    const host = makeFakeHost();
    const seen: Array<XrayEvents['preset:applied']> = [];
    host.on('preset:applied', (payload) => {
      seen.push(payload);
    });
    const preset: Preset = () => [
      fakePlugin('good'),
      throwingPlugin('bad', 'nope'),
    ];
    const result = await applyPreset(host, preset, ctx, { presetName: 'insights' });
    expect(seen.length).toBe(1);
    const ev = seen[0]!;
    expect(ev.presetName).toBe('insights');
    expect(ev.applied).toEqual(result.applied);
    expect(ev.skipped).toEqual(result.skipped);
    expect(ev.errored).toEqual(['bad']);
    expect(Object.keys(ev.timings).sort()).toEqual(['bad', 'good']);
  });
});
