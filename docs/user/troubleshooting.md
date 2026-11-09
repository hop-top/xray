# Troubleshooting Guide

Solutions to common issues and problems with xray.

## Installation Issues

### C++ Compilation Errors

**Problem:** Installation fails with C++ compilation errors.

**Solution:**
```bash
# Set C++ standard explicitly
CXXFLAGS="-std=c++20" npm install

# On macOS, ensure Xcode Command Line Tools installed
xcode-select --install

# On Linux, ensure build-essential installed
sudo apt-get install build-essential
```

### Peer Dependency Conflicts

**Problem:** npm shows peer dependency warnings or errors.

**Solution:**
```bash
# Plain install must succeed: the root package.json overrides the grammars'
# stale tree-sitter peer range, so no peer-dependency flag is needed.
rm -rf node_modules && npm ci
```

### Missing tree-sitter Parsers

**Problem:** Language not supported or parser missing errors.

**Solution:**

The tree-sitter parsers are included as dependencies. If you encounter missing parser errors:

1. Clear node_modules and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

2. Check [supported languages](../../README.md#supported-languages) - Dart and Lua are currently unsupported due to version incompatibility.

## Runtime Issues

### "Command not found"

**Problem:** `xray` command not found after installation.

**Solution:**
```bash
# Ensure global install path is in PATH
npm prefix -g   # binaries live in <prefix>/bin

# Add to PATH if needed (example for bash)
echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Or use npx
npx @hop-top/xray map
```

### Cache Issues

**Problem:** Analysis results seem outdated or stale.

**Solution:**
```bash
# Clear cache
xray clear-cache --confirm=yes

# Run analysis again
xray map
```

### Token Limit Errors

**Problem:** Output is truncated or incomplete.

**Solution:**
```bash
# Increase token limit
xray map --limit 10000

# Or reduce scope
xray map --depth 3 --match "!*.test.ts"
```

### Large Codebase Performance

**Problem:** xray is slow on large codebases.

**Solution:**

1. Use file filters to reduce scope:
```bash
xray map --match "*.ts" --match "!*.test.ts" --match "!node_modules/**"
```

2. Reduce depth:
```bash
xray map --depth 3
```

3. Focus on specific paths:
```bash
xray map --path ./src/core
```

4. Use anchor to focus analysis:
```bash
xray map --anchor src/main.ts
```

## Strategy Issues

### Strategy Not Detected

**Problem:** `xray strategy detect` doesn't show your framework.

**Solutions:**

1. **For React**: Check `package.json` has `react` or `react-dom` dependency
2. **For Express**: Check `express` is in dependencies (not just devDependencies)
3. **For Go CLI**: Check `go.mod` includes Cobra or urfave/cli
4. Clear cache and retry:
```bash
xray clear-cache --confirm=yes && xray strategy detect
```

### No Results from Strategy Command

**Problem:** Strategy command returns "Total: 0".

**Solutions:**

1. Verify files exist in expected locations
2. Check file extensions match what strategy expects
3. For React: Ensure components are exported (not just internal functions)
4. For Express: Ensure routes are actually defined (not commented out)
5. Run with `-p` flag to specify correct project path:
```bash
xray react components -p /full/path/to/project
```

### Slow Strategy Performance

**Problem:** Strategy commands take a long time to run.

**Solutions:**

1. First run is slower (AST parsing + detection). Subsequent runs use cache.
2. Clear stale cache if you've made many changes:
```bash
xray clear-cache --confirm=yes
```
3. Check the cache file size (`cache-db` in `xray paths`) - delete if too large (it will regenerate)

### Outdated Strategy Results

**Problem:** Strategy command shows old results after code changes.

**Solutions:**

1. Cache invalidates based on file modification time (should be automatic)
2. Force cache clear:
```bash
xray clear-cache --confirm=yes
```
3. Verify files were actually saved (check file timestamps)

## Automation Issues

### GitHub Action: "No config file found"

**Problem:** GitHub Action fails with config not found error.

**Solution:**

1. Ensure `.xrayrc.json` or similar exists in repository root
2. Check file is committed and pushed to repository
3. Verify file name matches expected patterns

### GitHub Action: Changes Not Being Committed

**Problem:** Action runs but doesn't commit updated maps.

**Solution:**

1. Verify workflow has `contents: write` permission:
```yaml
permissions:
  contents: write
```

2. Check `ref: ${{ github.head_ref }}` is set in checkout step:
```yaml
- uses: actions/checkout@v4
  with:
    ref: ${{ github.head_ref }}
```

### GitHub Action: Maps Don't Update

**Problem:** Action runs successfully but maps aren't updated.

**Solution:**

1. Run `xray map` locally to verify config
2. Check action logs for error messages
3. Verify output path in config is correct
4. Ensure source files actually changed

### Pre-commit Hook: "Xray not installed"

**Problem:** Hook complains xray is not installed.

**Solution:**

```bash
# Install globally
npm install -g @hop-top/xray

# Or modify hook to use npx
# Edit .git/hooks/pre-commit and change:
# xray map
# to:
# npx @hop-top/xray map
```

### Pre-commit Hook: Not Running

**Problem:** Hook doesn't execute on commit.

**Solution:**

1. Check file exists:
```bash
ls -la .git/hooks/pre-commit
```

2. Check executable permission:
```bash
chmod +x .git/hooks/pre-commit
```

3. Verify config file exists in project root

### Pre-commit Hook: Maps Not Being Staged

**Problem:** Maps are regenerated but not included in commit.

**Solution:**

The hook maps your staged files and stages only the files xray changed. Verify:
1. A config file is tracked or staged: an untracked config is skipped, and the hook says so
2. Output path in config is correct
3. xray map command succeeds (a failure stops the commit)
4. Files are actually being generated

## Output Issues

### Missing Cross-References

**Problem:** Expected cross-file references don't appear.

**Solution:**

Enable imports feature:
```bash
xray map --with incs
```

### Empty or Minimal Output

**Problem:** Output file is nearly empty.

**Solution:**

1. Check file patterns aren't excluding everything. When `--match` (or the
   `match` list in config) matches no file, xray warns `No files match
   --match ...` on stderr. Compare with `xray explore --match`, which lists
   what the same patterns select:
```bash
xray explore --match "*.ts" --match "*.js"
```

2. Increase depth limit:
```bash
xray map --depth 10
```

3. Increase token limit:
```bash
xray map --limit 16000
```

### Incorrect Line Numbers

**Problem:** Line numbers in output don't match source files.

**Solution:**

This usually indicates cache issues. Clear cache and regenerate:
```bash
xray clear-cache --confirm=yes
xray map
```

## Path Issues

### Relative vs Absolute Paths

**Problem:** Commands work in one directory but not another.

**Solution:**

Always use absolute paths with `-p` flag:
```bash
xray react components -p /full/path/to/project
```

Or ensure you're in the project root when running without `-p`.

### Path Not Found Errors

**Problem:** xray can't find specified paths.

**Solution:**

1. Verify path exists:
```bash
ls -la /path/to/directory
```

2. Check for typos in config or command
3. Use absolute paths instead of relative paths

## Language-Specific Issues

### Unsupported Languages

**Problem:** Dart or Lua files not being analyzed.

**Explanation:**

Dart and Lua are not currently supported due to tree-sitter version incompatibility. See [issue #6](https://github.com/hop-top/xray/issues/6) for details.

**Workaround:**

Filter out these files in config:
```json
{
  "match": ["!*.dart", "!*.lua"]
}
```

### TypeScript Generic Syntax

**Problem:** Complex TypeScript generics cause parsing errors.

**Solution:**

This is a known limitation. The AST parser handles most cases, but extremely complex generic syntax may cause issues. Simplify type definitions if possible, or report the issue with a minimal reproduction.

## Getting More Help

If you're still experiencing issues:

1. Check [GitHub Issues](https://github.com/hop-top/xray/issues) for similar problems
2. Search [closed issues](https://github.com/hop-top/xray/issues?q=is%3Aissue+is%3Aclosed) for solutions
3. Create a [new issue](https://github.com/hop-top/xray/issues/new) with:
   - xray version (`xray --version`)
   - Operating system
   - Node.js version
   - Full error message
   - Minimal reproduction steps

## See Also

- [Getting Started](getting-started.md) - Installation and setup
- [Commands Reference](commands.md) - All available commands
- [Configuration](configuration.md) - Config file options
- [Automation](automation.md) - GitHub Actions and hooks
