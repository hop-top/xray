# US-0004 — onboarding preset must not include surprise analysis

author: $USER
status: active
related-tracks: [xray-presets-init]

## context

The `onboarding` preset exists for users who are meeting a repository
for the first time. Surprise scoring on an unfamiliar graph produces
noise, not insight — a newcomer has no baseline to decide what is
"surprising" about an edge they've never seen before. Clustering and
question generation, by contrast, help the newcomer build a mental
model of the structure and know where to look next.

This story nails down the "no surprise analyzer" invariant so the
preset cannot regress into silently including it.

## acceptance

- given `xray map --preset onboarding` against any project
- when the command runs
- then `xray.plugins()` contains `confidence-enricher`, `clustering`,
  and `question-generator`, and does NOT contain `surprise-analyzer`
- and the surprise stash (`xray.retrieve('surprise')`) is empty
  because no plugin ever stashed into it

## non-regression invariants

1. `createOnboardingPreset(ctx)` returns exactly three plugin
   instances: confidence-enricher, clustering, question-generator.
2. The names of those three instances never include
   `surprise-analyzer`.
3. After `applyPreset` on a fresh xray, `xray.retrieve('surprise')`
   returns an empty array.
4. The question generator's degradation path produces its own
   community / centrality based fallback questions when there is no
   surprise data — covered by
   `__tests__/integration/question-generator-degradation.test.ts`
   from the upstream track.

## verified by

- unit: `__tests__/plugins/presets/onboarding.test.ts`
- integration: `__tests__/integration/presets/cli-builtin.test.ts`
  (`onboarding: no surprise analyzer; surprise stash empty (US-0004)`)
