# US-0003 — plugin presets are extensible and composable

author: $USER
status: active
related-tracks: [xray-presets-init]

## context

Before this track, the CLI had no way to wire the full confidence →
clustering → surprise → question pipeline, and the package exports no
library API (`Xray`, `use()`) to assemble one in user code. Users also had
no vocabulary for "I want the onboarding experience" vs "I want raw
exploration data".

The preset primitive ships:

- a typed `Preset` factory + `applyPreset` runner with idempotent
  composition and per-plugin error isolation
- three built-in presets (`insights`, `onboarding`, `exploration`)
- a repeatable `--preset <spec>` CLI flag that resolves a built-in name,
  a local file path, or an npm package and wires the result
- a resolver that refuses to let an installed `xray-preset-insights`
  package shadow the built-in via the bare `insights` name

## acceptance

- given `xray map --preset insights` against any project
- when the command runs
- then all four feature plugins are registered exactly once and the
  root chunk contains the "Suggested Questions for Exploration"
  insight header

- given `xray map --preset ./my-preset.js` pointing at a file that
  default-exports a `Preset` factory
- when the command runs
- then the plugins returned by the factory are registered and applied

- given `xray map --preset insights --preset onboarding`
- when the command runs
- then every plugin is registered exactly once (composition idempotency)

- given `xray map --preset bogus-name`
- when the resolver runs
- then it throws a `PresetResolutionError` (exit 2) whose message lists
  all built-in names, and the command analyzes and writes nothing

## non-regression invariants

1. `BUILTIN_PRESETS` exports exactly three factories under the keys
   `insights`, `onboarding`, `exploration` — no more, no fewer.
2. `applyPreset` uses `useIfAbsent` so duplicate plugin names across
   composed presets never double-register.
3. One plugin throwing inside `apply()` does NOT abort the runner —
   the error is recorded in `ApplyPresetResult.errored` and later
   plugins still register.
4. `resolvePreset` resolves bare built-in names BEFORE any path or
   package lookup (anti-typosquat guard, spec C-3).
5. Default `xray map` without any `--preset` flag produces output that
   is byte-identical (modulo timestamp + path normalisation) to the
   pre-track baseline.

## verified by

- unit: `__tests__/plugins/presets/apply.test.ts`
- unit: `__tests__/plugins/presets/resolve.test.ts`
- unit: `__tests__/plugins/presets/{insights,onboarding,exploration}.test.ts`
- integration: `__tests__/integration/presets/cli-builtin.test.ts`
- integration: `__tests__/integration/presets/composition.test.ts`
- integration: `__tests__/integration/presets/custom-preset.test.ts`
- integration: `__tests__/integration/presets/default-unchanged.test.ts`
