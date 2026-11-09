# Plugin examples

Reference plugins for xray's event system. They are **in-repo examples**:
this directory is not published in the `@hop-top/xray` package (see the
`files` list in `package.json`), and the files import xray internals
by relative path (`../../src/lib/events/plugin`). They cannot be
imported from an installed package; there is no `Xray` export and no
`xray.use()`.

To use one, load it through a custom preset from a source checkout.
Preset mechanics and limits: [docs/user/plugins.md](../docs/user/plugins.md).

## Run them from a checkout

The examples are TypeScript and are not compiled by the build, so the
preset file registers `ts-node` (a dev dependency) before requiring them.

```bash
git clone <repo> && cd xray
npm ci && npm run build
```

Save this as `examples-preset.js` in the project you want to analyze
(adjust `XRAY_REPO`):

```js
const XRAY_REPO = '/path/to/xray';
require(XRAY_REPO + '/node_modules/ts-node').register({
  transpileOnly: true,
  project: XRAY_REPO + '/tsconfig.json',
  compilerOptions: { module: 'commonjs' },
});
const dir = XRAY_REPO + '/examples/plugins/';
const { SkipTestsPlugin } = require(dir + 'skip-tests.ts');
const { FilterPrivatePlugin } = require(dir + 'filter-private.ts');

module.exports = () => [new SkipTestsPlugin(), new FilterPrivatePlugin()];
```

```bash
cd /path/to/project
node /path/to/xray/dist/index.js map -p src --preset ./examples-preset.js
```

With a `*.test.*` file and an `_private` function in `src`, the test file
is left out of the map and the run prints `Filtered 1 private function`.
Remove the preset by dropping the flag. Remember that tags edited in
`parse:after` are cached: see the cache note in
[docs/user/plugins.md](../docs/user/plugins.md#events-a-plugin-can-observe).

## The plugins

All live in [`plugins/`](plugins/). Each is a class with `name`, `version`
and `apply(xray)`, which is the shape a preset factory returns in an
array.

| File | Class | What it does | Notes |
|------|-------|--------------|-------|
| `progress-logger.ts` | `ProgressLoggerPlugin` | Colored scan/progress/graph logging | Total-time line prints on `render:complete`, so only with `--no-chunk` |
| `filter-private.ts` | `FilterPrivatePlugin` | Drops tags whose name starts with `_` (`parse:after`) and prints a count | |
| `skip-tests.ts` | `SkipTestsPlugin` | Sets `skip` on `scan:file` for `*.test.*`, `*.spec.*`, `__tests__/**`; constructor takes custom glob-like patterns | |
| `metrics-collector.ts` | `MetricsCollectorPlugin` | Counts files, cache hits/misses, tags, edges, duration; prints a summary on `render:complete` | Summary only with `--no-chunk`; `getMetrics()` is not reachable from the CLI |
| `sanitizer.ts` | `SanitizerPlugin` | Redacts bearer tokens, API keys, passwords in `parse:before` and docstrings in `parse:after`; constructor takes custom `{ pattern, replacement }` | |

Constructor arguments (custom patterns) work in a preset file because you
construct the plugin yourself:

```js
const { SanitizerPlugin } = require(dir + 'sanitizer.ts');
module.exports = () => [
  new SanitizerPlugin([{ pattern: /SECRET_[A-Z_]+/g, replacement: 'SECRET_[HIDDEN]' }]),
];
```

## Writing your own

A plugin needs no TypeScript, imports or classes; a plain object works
and ships as a standalone preset file. See
[docs/user/plugins.md](../docs/user/plugins.md) and the event table in
[docs/agent/events.md](../docs/agent/events.md).

## Contributing an example

1. Add `plugins/your-plugin.ts` exporting a class with `name` and
   `apply(xray)`.
2. Add a row to the table above and check it loads with the recipe above.
3. Add tests under `__tests__/plugins/`.
