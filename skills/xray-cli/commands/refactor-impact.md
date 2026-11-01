# Refactor impact
Goal: blast radius, public surface.

```bash
xray impact <symbol>                      # transitive callers by area (default --depth 3)
xray impact <symbol> --depth 1 --strict   # direct callers, EXTRACTED edges only
xray impact 'Auth*' --format json         # glob; counts + groups for scripts
xray map --anchor <subsystem>/index.ts --with incs
```

EXTRACTED = resolved via file/dir/imports; INFERRED = name match only, verify.

Fallback, text search (impact: `no matching symbol in the graph`):

```bash
xray map --catch "*Auth*" --with incs
```
