/**
 * applyPreset — idempotent preset runner with per-plugin error
 * isolation and wallclock timings.
 *
 * Contract:
 *
 *  1. Calls `preset(ctx)` to materialise the plugin list.
 *  2. For each plugin in order, calls `xray.useIfAbsent(plugin)` so
 *     already-registered plugins are silently skipped (logged at
 *     debug). This is what makes `--preset insights --preset onboarding`
 *     composition safe.
 *  3. Every plugin is wrapped in try/catch. A thrown `apply()` does
 *     NOT abort the loop — the error is recorded in `result.errored`,
 *     logged as a warning, and the runner moves on. C-2 in spec.
 *  4. Wallclock per plugin is measured via `process.hrtime.bigint()`
 *     and written into `result.timings[name]` regardless of outcome.
 *  5. Emits a `preset:applied` telemetry event with the structured
 *     result + caller-supplied resolved name. Caller chooses the name
 *     so the runner stays ignorant of built-in vs custom resolution.
 *  6. Returns the full `ApplyPresetResult`.
 *
 * The runner is intentionally ignorant of:
 *   - Which presets are "built-in" vs custom (resolved upstream).
 *   - How the caller plans to log / surface the result.
 *   - Renderer state. It only touches `xray.useIfAbsent` + `xray.emit`.
 */

import type { XrayLike, XrayPlugin } from '../../events/plugin';
import { Logger } from '../../logger';
import type { ApplyPresetResult, Preset, PresetContext } from './types';

/**
 * Narrow structural surface `applyPreset` needs from an Xray-like
 * host. Matches `Xray.useIfAbsent` + the typed event emitter. Kept
 * as an intersection type (not a new interface) so this stays a
 * pure consumer of existing core contracts.
 */
type PresetHost = XrayLike & {
  useIfAbsent: (plugin: XrayPlugin) => Promise<unknown>;
  plugins?: () => XrayPlugin[];
};

function hrtimeNowMs(): number {
  // bigint → number conversion is safe: max duration we care about is
  // ~minutes, well under 2^53 ns.
  return Number(process.hrtime.bigint()) / 1_000_000;
}

export interface ApplyPresetOptions {
  /**
   * Caller-supplied resolved name for telemetry. Typically a built-in
   * name (`'insights'`) or a custom spec (`'./my-preset.js'`). Falls
   * back to `'<anonymous>'` if omitted.
   */
  presetName?: string;
}

export async function applyPreset(
  xray: PresetHost,
  preset: Preset,
  ctx: PresetContext,
  options: ApplyPresetOptions = {}
): Promise<ApplyPresetResult> {
  const presetName = options.presetName ?? '<anonymous>';
  const result: ApplyPresetResult = {
    applied: [],
    skipped: [],
    errored: [],
    timings: {},
  };

  let plugins: XrayPlugin[];
  try {
    plugins = preset(ctx);
  } catch (err) {
    Logger.error(
      `[presets] factory threw for "${presetName}"`,
      err as Error
    );
    throw err;
  }

  for (const plugin of plugins) {
    const name = plugin.name;
    const alreadyPresent = typeof xray.plugins === 'function'
      ? xray.plugins().some((p: XrayPlugin) => p.name === name)
      : false;

    // Short-circuit: if the plugin is already registered, record a
    // debug-level skip and DO NOT call `useIfAbsent`. Core's
    // `PluginManager.applyIfAbsent` logs a `warn` when it detects a
    // duplicate (`src/lib/events/plugin.ts`), which would be noisy
    // during legitimate preset composition. By gating the call we
    // keep the composition path quiet (debug only) while preserving
    // every other guarantee of the runner.
    if (alreadyPresent) {
      const elapsed = hrtimeNowMs() - 0; // 0 work done; record 0ms
      result.timings[name] = 0;
      void elapsed;
      result.skipped.push(name);
      Logger.debug(
        `[presets] skipped "${name}" (already registered)`
      );
      continue;
    }

    const start = hrtimeNowMs();
    try {
      await xray.useIfAbsent(plugin);
      const elapsed = hrtimeNowMs() - start;
      result.timings[name] = elapsed;
      result.applied.push(name);
      Logger.debug(
        `[presets] applied "${name}" in ${elapsed.toFixed(3)}ms`
      );
    } catch (err) {
      const elapsed = hrtimeNowMs() - start;
      result.timings[name] = elapsed;
      const error = err instanceof Error ? err : new Error(String(err));
      result.errored.push({ name, error });
      Logger.warn(
        `[presets] plugin "${name}" failed to apply in ` +
          `${elapsed.toFixed(3)}ms: ${error.message}`
      );
    }
  }

  // Fire-and-forget telemetry. Listeners are typed via `XrayEvents`.
  // We cast through `unknown` because `applyPreset` keeps its host
  // type intersection loose (the runner does not depend on the full
  // Xray event map, only the narrow useIfAbsent surface above).
  try {
    const emitter = xray as unknown as {
      emit?: (name: 'preset:applied', payload: unknown) => void;
      emitAsyncParallel?: (
        name: 'preset:applied',
        payload: unknown
      ) => Promise<void>;
    };
    const payload = {
      presetName,
      applied: result.applied,
      skipped: result.skipped,
      errored: result.errored.map((e) => e.name),
      timings: result.timings,
    };
    if (typeof emitter.emitAsyncParallel === 'function') {
      await emitter.emitAsyncParallel('preset:applied', payload);
    } else if (typeof emitter.emit === 'function') {
      emitter.emit('preset:applied', payload);
    }
  } catch (err) {
    Logger.debug(
      `[presets] telemetry emission for "${presetName}" threw: ${String(err)}`
    );
  }

  return result;
}
