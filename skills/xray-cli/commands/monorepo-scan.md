# Monorepo scan
Goal: per-package overview.

```bash
for p in packages/*/; do xray map -p "$p" --depth 2 --with incs; done
```
