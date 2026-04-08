---
title: "Plugin presets: --use <name|path|pkg>"
author: jadb
date: 2026-04-08
track: xray-presets-init
---

# Plugin presets

## What presets are

Presets are named bundles of xray plugins. One `--use <name>` flag wires a
curated set of feature plugins into the `xray map` pipeline — confidence,
clustering, surprise, questions — instead of requiring callers to assemble
the stack by hand. Presets compose; users can also ship their own.

## Built-in catalog

| Preset | Plugins | When to use |
|---|---|---|
| `insights` | confidence-enricher, clustering, surprise-analyzer, question-generator | Full stack. "Give me everything" default. Best for unfamiliar repos where you want narrative + raw signal together. |
| `onboarding` | confidence-enricher, clustering, question-generator | Skips surprise scoring. Less noise for newcomers who just want structural clustering and human-readable questions. |
| `exploration` | confidence-enricher, surprise-analyzer | Raw surprise signal, no grouping, no questions. For power users who consume `xray.retrieve('surprise', n)` directly. |

## Composing presets

`--use` is repeatable. Later presets compose with earlier ones via
`useIfAbsent` — a plugin already registered is silently skipped (logged at
debug):

```
xray map --use insights --use onboarding
```

The second preset contributes zero new plugins in the above example because
`onboarding` is a strict subset of `insights`. Order matters only for
plugins you are adding on top: the first preset wins plugin-instance
ownership.

## Writing your own

A preset is a function:

```pseudocode
// my-preset.js
const { SomePlugin } = require('xray/lib/plugins/some');
module.exports = function myPreset(ctx) {
  return [new SomePlugin({ root: ctx.root })];
};
module.exports.default = module.exports;
```

Use exact code when your preset is not pseudocode. Load it with:

```
xray map --use ./my-preset.js
xray map --use @scope/xray-preset-foo
```

The resolver imports the spec as a CJS or ESM module and expects a default
export that is a function matching `(ctx: PresetContext) => XrayPlugin[]`.
Named exports are accepted as a fallback — first function wins.

## Loading user presets — security note

`--use ./path` and `--use @scope/pkg` execute arbitrary JavaScript in your
current process. Only pass paths and package names you trust. xray does
NOT sandbox custom presets. This is a developer CLI running locally; the
threat model matches `require('./any-file')` from any Node script.

## `--use` vs `--preset`

These are two distinct mechanisms. Do not confuse them.

- `--use <name>` (this doc) applies a **plugin preset** — a bundle of
  runtime plugins that subscribe to the xray event pipeline. Built-ins:
  `insights`, `onboarding`, `exploration`. Custom: any local path or npm
  package exporting a `Preset` factory.
- `--preset <name>` (config-file overlay) selects a **named config-file
  preset** from your `.xrayrc` / `xray.config.*` file. These are CLI
  option overlays (e.g. "default to chunked, with `--with incs`"), not
  plugin bundles.

Rule of thumb: `--use` loads code; `--preset` loads config. They can be
combined on the same command line.
