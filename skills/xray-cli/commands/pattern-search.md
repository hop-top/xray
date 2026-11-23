# Pattern search / hotspots
Goal: find candidates fast.

```bash
xray map --symbol "*Handler" --with incs
xray map --symbol "*Controller" --with incs
xray map --with incs --no-chunk -o map.txt
grep -i "auth\|jwt\|oauth" map.txt
```
