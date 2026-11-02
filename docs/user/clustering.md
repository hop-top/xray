---
title: "Logical clustering: --group community"
author: jadb
date: 2026-04-08
track: logical-clustering-init
---

# Logical clustering

## What it is

Xray groups chunked map output by **graph community**, not by filesystem directory, when you pass
`--group community`. Communities are computed via Louvain over the symbol graph.

## Why it exists

Directory layout does not equal functional cohesion. A symbol in `src/utils/` may belong to the
auth domain. Community detection pulls functionally-coupled symbols into the same chunk regardless
of where they live on disk.

## Default edge filter: `calls`-only

By default `cluster()` runs Louvain on a **`calls`-only subgraph**. Mixing `defines`, `calls`, and
`imports` edges with uniform weights produces a structural tautology (each file + its own symbols
collapse into one community because of the per-file `defines` star). Filtering to `calls` keeps
the signal functional.

Symbols that have **no `calls` edges** (file nodes, isolated helpers) land in the sentinel community
`-1`. The root chunk labels them `Unclustered`.

## Determinism

Louvain is seeded with a fixed default (`42`), so the same graph yields the same community IDs and the same bridge / low-cohesion questions on every run; pass an `rng` option to `cluster()` or the `ClusteringPlugin` constructor to override it.

## Example

```
# Default: directory-grouped chunks (unchanged)
xray map

# Community-grouped chunks
xray map --group community
```

Output when `--group community`:

- One chunk file per community, ordered by size desc.
- A `root` index listing every community with its top-5 ranked nodes.
- Communities that overflow `--limit` emit a `log.warn` and fall through to the existing
  truncation path. Sub-chunking is not implemented yet (see spec R4).

## Gating on modularity

`cluster()` stamps `graph.setAttribute('clusteringModularity', ...)`. Downstream tracks can read
this attribute and skip cross-community analyses when it is below `0.10` (a trivial partition).
The plugin also logs a warning when it falls under that threshold.

## Related

- `src/lib/graph/cluster.ts` — the wrapper.
- `src/lib/plugins/clustering.ts` — the plugin.
- `src/lib/renderer/chunked-renderer.ts` — community grouping mode.
- Spec: `.tlc/tracks/logical-clustering-init/spec.md`.
