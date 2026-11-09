# US-0001 — insight survives the chunked dual-renderer handoff

author: $USER
status: active
related-prs: [14]
related-tracks: [question-generator-init]

## context

`Xray.buildGraph()` (the chunked-CLI entry point) emits `render:start` with
its own internal `ChunkedRenderer` instance. `src/commands/generate.ts`
then constructs a *different* `ChunkedRenderer` and renders chunks with
that one. The first instance is observability-only — anything plugins
mutate on it is discarded.

The question-generator plugin originally called
`event.renderer.addInsight(...)` directly on the observability-only
instance. Result: insights showed up in unit tests (which rendered the
captured renderer) but never in the real `xray map` output. PR #14 review
caught this as a critical bug.

## acceptance

- given a configured `Xray` with `QuestionGeneratorPlugin` registered
- when `xray map` runs (chunked path via `src/commands/generate.ts`)
- then the root chunk on disk contains the literal heading
  `## Suggested Questions for Exploration` and at least one `### `
  question heading underneath

## non-regression invariants

1. `QuestionGeneratorPlugin.apply` writes insights to BOTH the
   `render:start` renderer AND the `'insights'` stash namespace.
2. `src/commands/generate.ts` calls `applyStashedInsights(xray, real)`
   after constructing its `ChunkedRenderer`, before `renderChunked()`.
3. `applyStashedInsights` is a no-op when nothing has been stashed.
4. `Insight` is defined exactly once (in `src/lib/renderer/insight.ts`)
   and re-exported from both renderer modules — no shape drift.

## verified by

- unit: `__tests__/renderer/insight.test.ts` (apply helper)
- integration: `__tests__/integration/question-generator-pipeline.test.ts`
  (generate.ts-style flow: buildGraph → construct fresh ChunkedRenderer →
  applyStashedInsights → renderChunked → assert root chunk)
