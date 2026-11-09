# Bug trace path
Goal: trace error up/down stack.

```bash
xray map --path <suspect-area> --with incs
xray map --anchor <suspect-file> --with incs --with vars
xray graph --anchor <suspect-file> --with df
```
