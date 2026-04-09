# US-0005 — exploration preset exposes raw surprise signal only

author: $USER
status: active
related-tracks: [xray-presets-init]

## context

Power users who consume `xray.retrieve('surprise', n)` programmatically
don't want clustering or pre-generated questions cluttering their
output. The `exploration` preset is the opposite of `onboarding` — it
ships only the two plugins a script needs to score edges: the
confidence enricher and the surprise analyzer. No clustering. No
human-readable question block in the root chunk.

This story locks both exclusions so a future "helpful" addition can't
sneak the removed plugins back into the bundle.

## acceptance

- given `xray map --preset exploration` against any project
- when the command runs
- then `xray.plugins()` contains `confidence-enricher` and
  `surprise-analyzer`, and does NOT contain `clustering` or
  `question-generator`
- and the surprise stash is non-empty (it is the entire point of this
  preset)
- and the root chunk does NOT contain the "Suggested Questions for
  Exploration" insight header

## non-regression invariants

1. `createExplorationPreset(ctx)` returns exactly two plugin instances:
   confidence-enricher, surprise-analyzer.
2. Neither `clustering` nor `question-generator` is ever registered by
   this preset.
3. `xray.retrieve('surprise')` returns at least one scored edge after
   a buildGraph run on any non-empty fixture.
4. The root chunk produced by the chunked pipeline does not include
   the insight block header.

## verified by

- unit: `__tests__/plugins/presets/exploration.test.ts`
- integration: `__tests__/integration/presets/cli-builtin.test.ts`
  (`exploration: no questions header; surprise stash populated`)
