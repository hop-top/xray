---
title: "Plugin presets: --preset <name|path|pkg>"
author: jadb
date: 2026-04-08
track: xray-presets-init
---

# Plugin presets

## What presets are

Presets are named bundles of xray plugins. One `--preset <name>` flag
wires a curated set of feature plugins into the `xray map` pipeline —
confidence, clustering, surprise, questions — instead of requiring
callers to assemble the stack by hand. Presets compose; users can also
ship their own.

## Built-in catalog

| Preset | Plugins | When to use |
|---|---|---|
| `insights` | confidence-enricher, clustering, surprise-analyzer, question-generator | Full stack. "Give me everything" default. Best for unfamiliar repos where you want narrative + raw signal together. |
| `onboarding` | confidence-enricher, clustering, question-generator | Skips surprise scoring. Less noise for newcomers who just want structural clustering and human-readable questions. |
| `exploration` | confidence-enricher, surprise-analyzer | Raw surprise signal, no grouping, no questions. For power users who consume `xray.retrieve('surprise', n)` directly. |

## Composing presets

`--preset` is repeatable. Later presets compose with earlier ones via
`useIfAbsent` — a plugin already registered is silently skipped
(logged at debug):

```
xray map --preset insights --preset onboarding
```

The second preset contributes zero new plugins in the above example
because `onboarding` is a strict subset of `insights`. Order matters
only for plugins you are adding on top: the first preset wins
plugin-instance ownership.

## Writing your own

A preset is a function that returns plugins; a plugin is an object with
a `name` and an `apply(xray)` method that subscribes to events:

```js
// my-preset.js
module.exports = function myPreset(ctx) {
  return [{
    name: 'log-graph',
    apply(xray) {
      xray.on('graph:complete', (e) => {
        console.error(`${e.nodeCount} nodes under ${ctx.root}`);
      });
    },
  }];
};
```

Load it with:

```
xray map --preset ./my-preset.js
xray map --preset @scope/xray-preset-foo
```

The resolver loads the spec as a CJS or ESM module and expects a default
export (or `module.exports`) that is a function matching
`(ctx: PresetContext) => XrayPlugin[]`. Named exports are accepted as
a fallback; first function wins. xray internals cannot be imported from
a preset (the package `exports` map blocks deep paths). Events, load
errors and limits: [plugins.md](plugins.md).

## Loading user presets — security note

`--preset ./path` and `--preset @scope/pkg` execute arbitrary
JavaScript in your current process. Only pass paths and package names
you trust. xray does NOT sandbox custom presets. This is a developer
CLI running locally; the threat model matches `require('./any-file')`
from any Node script.

## Cache

A run with `--preset` does not read or write the per-file parse cache, and
skips the multi-root graph cache. Presets can edit tags, so their results
must not reach runs without that preset, or with another one. Editing a
local preset file takes effect on the next run for the same reason.

Cost: every file is parsed on every preset run, as after `xray cache
clear`. On a large repo that is the full cold-parse time each run. Runs
without `--preset` keep the cache and its speed, and are unaffected by
earlier preset runs.

## Bad presets fail the run

A `--preset` that cannot be used stops the command before any analysis or
write:

| Case | Exit |
|------|------|
| Unknown built-in name (valid names listed, nearest suggested) | 2 |
| Path or package that does not exist | 3 |
| Module that throws on load, has no preset function, or whose factory throws | 2 |

Presets come from the command line only; a config file cannot name one.

## `--preset` vs `--lens`

These are two distinct mechanisms. Do not confuse them.

- `--preset <spec>` (this doc) applies a **plugin preset** — a bundle
  of runtime plugins that subscribe to the xray event pipeline.
  Built-ins: `insights`, `onboarding`, `exploration`. Custom: any
  local path or npm package exporting a `Preset` factory.
- `--lens <name>` selects a **named config-file overlay** from your
  `xray.config.*` file. A lens is a named set of CLI option defaults —
  "view the same repo through this angle" (e.g. `quick`, `detailed`,
  `api-only`). See [configuration.md](configuration.md#using-lenses).

Rule of thumb: `--preset` loads code; `--lens` loads config. They can
be combined on the same command line:

```
xray map --lens quick --preset insights
```
