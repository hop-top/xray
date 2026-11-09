# Dependency Decisions

Log of external dependency additions with vet notes. New entries go on top.
Each entry captures the `rsx analyze` snapshot, red-signal review, and the
decision rationale, per AGENTS.md.

## `graphology-communities-louvain` — 2026-04-08 (T-0028)

- Owner repo: `graphology/graphology` (monorepo; subpackage has no standalone
  GitHub repo, so `rsx analyze graphology/graphology` is the authoritative
  signal).
- npm: `graphology-communities-louvain@2.0.2`, published 2024-12-17, MIT,
  sole maintainer `yomguithereal` (also the graphology author).
- `rsx analyze graphology/graphology` (quick, balanced): **PASS 5.4/10**.
  - Maintenance 8.0, Release hygiene 8.0, License 10.0, Security 5.4.
  - Activity 1.4 and Adoption 1.1 flagged low — expected for a niche graph
    library, not a kill signal.
  - Latest release 0.26.0; contributors 30; maintainers 3.
- Red-signal review:
  - Not unmaintained (release cycle active within last 18 months).
  - Not single-author stale — `yomguithereal` is an active maintainer across
    the `graphology/*` ecosystem.
  - No abandoned-repo flags, no license issues, no known CVEs.
- Decision: **OK to add**. Pin exact version in `package.json`.
- Scope of use: Phase 1 of `logical-clustering-init` — Louvain community
  detection wrapper in `src/lib/graph/cluster.ts`, seeded RNG for
  determinism. Replaces no existing dependency.
