# Pattern search / hotspots
Goal: find candidates fast.

```bash
xray map --catch "*Handler" --with incs
xray map --catch "*Controller" --with incs
xray map --with incs --no-chunk -o map.txt
grep -i "auth\|jwt\|oauth" map.txt
```
