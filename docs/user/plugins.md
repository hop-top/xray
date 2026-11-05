# Custom plugins via `--preset`

xray has no library API. The npm package exposes the CLI, the
`@hop-top/xray/strategy` types, and `schemas/*`; nothing exports an `Xray`
class, a `use()` method, or a `plugins` entry point. The one supported
route to custom plugin code is a custom **preset**: a module you point
`--preset` at.

## What a preset is

A preset is a function `(ctx) => plugins[]`. Each plugin is an object with
a `name` and an `apply(xray)` method; `apply` subscribes to events with
`xray.on(event, handler)`.

```js
// my-preset.js
module.exports = function myPreset(ctx) {
  // ctx.root: absolute path of the scanned root
  return [
    {
      name: 'skip-secrets',
      apply(xray) {
        xray.on('scan:file', (e) => {
          if (e.file.includes('secret')) e.skip = true; // drop from the map
        });
        xray.on('graph:complete', (e) => {
          console.error(`graph: ${e.nodeCount} nodes, ${e.edgeCount} edges`);
        });
      },
    },
  ];
};
```

```bash
xray map -p src --preset ./my-preset.js
```

Run against a 3-file project, this prints `graph: 4 nodes, 4 edges`
(without the plugin: 6 nodes, 5 edges) and `secret.js` is absent from the
map.

## Loading

`--preset <spec>` is repeatable and works on `map` and `graph`.

| Spec | Resolves to |
|------|-------------|
| `insights`, `onboarding`, `exploration` | built-in preset; always wins over any package of the same name |
| `./x.js`, `../x.js`, `/abs/x.js` | file, resolved against the current directory |
| `@scope/pkg`, `pkg/sub` | npm package, resolved from the current directory's `node_modules` |
| any other bare word | error listing the built-ins |

Module shape: `module.exports = fn`, `export default fn`, or a named
export that is a function (default first, otherwise the first function).
CommonJS and ESM (`.mjs`) both load; an ESM preset using top-level
`await` does not. xray does not transpile: a `.ts` preset loads only where
Node itself can `require` it (type stripping; checked on Node 26).

## Failure behavior

Every failure is a warning and the run continues with the default output
(exit code 0):

- file missing, module throws on load, or no function exported:
  `[presets] failed to apply "<spec>": ...`
- a plugin's `apply()` throws: that plugin is skipped, later plugins in
  the same preset still register
- two plugins with the same `name`: the second is skipped

## Events a plugin can observe

Plugins can read every event and, on sequential events, modify the payload.
Sequential listeners run in registration order; parallel ones are
observers only.

| Event | Mode | Mutable payload |
|-------|------|-----------------|
| `scan:start`, `scan:complete` | parallel | none |
| `scan:file` | sequential | `skip` |
| `cache:check`, `cache:miss` | parallel | none |
| `cache:hit`, `cache:write` | sequential | `tags`, `imports` |
| `parse:before` | sequential | `content`, `skip` |
| `parse:after` | sequential | `tags`, `imports` |
| `graph:add-file` | sequential | `tags`, `imports`, `skip` |
| `graph:add-node`, `graph:add-edge` | sequential | `attrs`, `skip` |
| `graph:complete`, `rank:start` | parallel | none |
| `rank:complete` | sequential | `rankedNodes` |
| `render:start` | sequential | renderer |
| `render:complete` | parallel | none |
| `progress` | parallel | none |
| `preset:applied` | parallel | none |

Payload fields and an event-by-event reference: [Event
reference](../agent/events.md).

Behaviors observed when running `xray map`:

- `scan:complete` fires before the per-file `scan:file` events.
- `parse:before`, `parse:after` and `graph:add-file` fire only for files
  missing from the cache; unchanged files fire `cache:hit` instead. With
  `--preset` the per-file cache is bypassed, so they fire for every file
  on every run.
- `render:complete` fires only with `--no-chunk`.
- Runs with `--preset` neither read nor write the per-file cache, so edits
  made by a preset never reach later runs.

## Not supported

- Registering plugins from code: no `new Xray()`, no `xray.use()`.
- Importing xray internals from a preset: deep paths such as
  `@hop-top/xray/dist/lib/plugins/clustering` fail with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- Selecting plugins or presets in a config file: `.xrayrc`,
  `.xrayrc.json`, `xray.config.json` and `package.json` ignore a `preset`
  key. Only the `--preset` flag loads preset code.
- Per-plugin options from the command line.
- Other commands: `--preset` is only read by `map`, `graph` and their
  `generate` alias.

## Security

A custom preset is arbitrary code running in the xray process with your
privileges. Pass only files and packages you trust. A relative path or
package name resolves against the current directory, so run it from a
directory you trust.

## Related

- Support for new file types or commands without plugin code:
  [Strategies](strategies.md)
- Built-in bundles and composing them: [Presets](presets.md)
- In-repo plugin examples (run from a source checkout):
  [examples/README.md](../../examples/README.md)
- Config file options: [Configuration](configuration.md)
