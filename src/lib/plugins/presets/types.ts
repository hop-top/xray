/**
 * Preset primitive types.
 *
 * A preset is a small factory function that returns an ordered list of
 * plugins to register on an `Xray` instance. Presets compose via
 * `applyPreset`, which uses `useIfAbsent` so repeat applications of
 * the same plugin are silently skipped (idempotent composition).
 *
 * The preset runner (`apply.ts`) is the sole authority on per-plugin
 * error isolation and timing — individual factories MUST NOT catch
 * their own registration errors.
 */

import type { XrayPlugin } from '../../events/plugin';

/**
 * Runtime context handed to every preset factory. `root` is the
 * absolute scan root; `opts` is a forward-compat bag reserved for a
 * future per-plugin option mechanism (see spec R3). Factories SHOULD
 * NOT read unknown keys from `opts` without a default.
 */
export interface PresetContext {
  root: string;
  opts?: Record<string, unknown>;
}

/**
 * A preset is a pure factory: `(ctx) => plugins`. Factories MUST
 * return a FRESH array of fresh plugin instances on every call —
 * plugin state is per-run, not shared.
 */
export type Preset = (ctx: PresetContext) => XrayPlugin[];

/**
 * Structured result from `applyPreset`. Callers use this to log,
 * surface warnings, or drive downstream behaviour.
 *
 * - `applied`: plugin names that successfully registered on this call.
 * - `skipped`: plugin names already present (hit `useIfAbsent` skip).
 * - `errored`: plugins whose `apply()` threw; the runner recorded the
 *    error and continued.
 * - `timings`: wallclock milliseconds per plugin name (entry for every
 *    plugin the runner attempted, regardless of outcome).
 */
export interface ApplyPresetResult {
  applied: string[];
  skipped: string[];
  errored: { name: string; error: Error }[];
  timings: Record<string, number>;
}

/**
 * Canonical built-in preset names. Kept as a string-literal union so
 * `BUILTIN_PRESETS` catalog lookup stays type-safe and the CLI help
 * text can cite the exact set without drift.
 */
export type BuiltinPresetName = 'insights' | 'onboarding' | 'exploration';
