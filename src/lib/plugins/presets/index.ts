/**
 * Presets barrel — catalog of built-in presets plus type and runner
 * re-exports for programmatic consumers.
 *
 * The catalog is the single source of truth: the CLI dispatch, the
 * docs page, and the resolver all read from `BUILTIN_PRESETS`. Adding
 * a new built-in means exactly one line here plus a new factory file.
 */

import type { BuiltinPresetName, Preset } from './types';
import { createInsightsPreset } from './insights';
import { createOnboardingPreset } from './onboarding';
import { createExplorationPreset } from './exploration';

export const BUILTIN_PRESETS: Record<BuiltinPresetName, Preset> = {
  insights: createInsightsPreset,
  onboarding: createOnboardingPreset,
  exploration: createExplorationPreset,
};

export const BUILTIN_PRESET_NAMES: readonly BuiltinPresetName[] = [
  'insights',
  'onboarding',
  'exploration',
];

export { createInsightsPreset } from './insights';
export { createOnboardingPreset } from './onboarding';
export { createExplorationPreset } from './exploration';
export { applyPreset } from './apply';
export type { ApplyPresetOptions } from './apply';
export { resolvePreset, assertPresetSpec, PresetResolutionError } from './resolve';
export type {
  Preset,
  PresetContext,
  ApplyPresetResult,
  BuiltinPresetName,
} from './types';
