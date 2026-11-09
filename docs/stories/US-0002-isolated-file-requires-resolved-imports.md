# US-0002 — isolated-file template requires resolved imports edges

author: $USER
status: active
related-prs: [14]
related-tracks: [question-generator-init]

## context

The `isolated-file` question template flags file nodes with no inbound
or outbound `imports` edges and no outbound `defines` edges. The
original implementation had a fallback: when the graph contained no
`imports`-typed edges, it scanned the `imports` node attribute (a
back-compat array of `Import` objects with module specifier strings)
and attempted to compute in-degree from those.

This fallback was incorrect: `Import.source` is a module specifier
(e.g. `'./foo'`, `'lodash'`), not a resolved file-node id. The lookup
`inboundCount.has(imp.source)` almost never matched, so `importsIn`
stayed 0 and the template produced false positives — flagging files as
isolated whenever real edges weren't available, regardless of whether
they were actually orphans.

PR #14 review caught this. The fallback was removed: when no imports
edges exist, the template returns an empty array. The plumbing track
guarantees imports edges via `GraphBuilder.buildImportEdges`, so the
fallback was only papering over a missing precondition.

## acceptance

- given a graph with at least one `imports`-typed edge
- when `isolatedFileTemplate(graph)` runs
- then it flags files with zero imports edges (in or out) and zero
  outbound defines edges as isolated

- given a graph with NO `imports`-typed edges (only `defines`/`calls`)
- when `isolatedFileTemplate(graph)` runs
- then it returns an empty array (no false positives from unresolved
  specifier strings)

## non-regression invariants

1. The template never reads `node.attributes.imports` (the back-compat
   specifier array) for in-degree calculation.
2. When `imports` edges are present, the template uses `countTypedEdges`
   on the graph itself.
3. When `imports` edges are absent, the template short-circuits and
   returns `[]` — does not guess.
4. Output is deterministic (lexicographic file sort, single pick).

## verified by

- unit: `__tests__/graph/questions.test.ts`
  - existing `isolated-file fires on graph with imports edges`
  - new `isolated-file returns empty when no imports edges exist`
  - new `isolated-file does not false-positive from unresolved specifiers`
- integration: covered transitively by US-0001 e2e test (a real
  `xray map` run on `src/` exercises the resolved-edges path)
