# CLI `config` noun: collision and resolution

## Context

xray ships a built-in strategy named `config` (`strategies/config.ts`). It
registers three commands against the user's **project**:

- `xray config list` — list configuration files found in the project
- `xray config keys` — list keys across those files
- `xray config values` — print values (with secret redaction)

The strategy is therefore a *consumer* of the noun `config`: from the user's
shell, `xray config <verb>` asks questions **about the user's project config**.

Separately, xray has its own runtime configuration: `.xrayrc{,.json,.js}`,
`xray.config.{js,json}`, `package.json#xray`, and the XDG global
(`$XDG_CONFIG_HOME/xray/config.json`). It also writes a SQLite analysis cache
to the user cache dir, keyed by project root.

There was previously **no** command answering "what config is xray itself
using right now?" — a basic introspection question every CLI agent or
debugger eventually asks. Wedging that introspection into the existing
`config` namespace was not viable because:

1. `xray config` is already wired to the strategy registration path; a
   sub-verb collision (e.g. `xray config path`) would either shadow or be
   shadowed by strategy commands, depending on registration order.
2. The semantic gap is real: "list config files in *my* project" vs. "show
   *xray's own* active config" are two different questions that happen to
   share a noun.

## Options considered

### Option 1 — Rename the strategy off `config`

Move `strategies/config.ts` to a different noun (`dotfiles`, `cfgfiles`,
etc.). Free up `xray config *` for introspection of xray's own state. Keep
the old noun as a hidden alias for one release.

**Pros**: matches conventional CLI usage where `<tool> config` means the
tool's own config (`git config`, `npm config`, `gh config`, `kubectl
config`). Long-term cleaner.

**Cons**: breaking change for any documented usage of `xray config
{list,keys,values}`. Touches the strategy registration mapping, the
strategy file, any strategy JSON/YAML manifests, and external docs. No
candidate noun is obviously better — `dotfiles` over-narrows (the strategy
also matches `*.yml`, `*.toml`), `cfgfiles` is clunky.

### Option 2 — Keep the strategy at `config`; add a new root verb for xray's own paths

Leave `xray config {list,keys,values}` untouched. Add a new root command —
`xray paths` — that prints the introspection facts: which config xray is
reading, where the analysis cache lives, what project root xray resolved.

**Pros**: zero breaking change. Single new file (`src/commands/paths.ts`).
The new verb is honest about what it does (it prints paths) and composes
with `--format json` for scripting.

**Cons**: diverges from the conventional `<tool> config` idiom. Users
arriving from `git config --list` or `npm config get` muscle memory may
overlook `xray paths`.

## Decision: Option 2

We add `xray paths`. The conventional-idiom argument for Option 1 is real
but is outweighed by:

- The strategy noun is **load-bearing** UX. `xray config-files list` is what users
  already type to inspect their `.env`/`*.yml` files. Renaming it for a
  cleanliness win is disproportionate.
- The introspection use case is small and self-describing — `xray paths` is
  legible without explanation.
- Naming a root verb is reversible. If we later rename the strategy noun in
  a major bump, `xray paths` can become an alias for `xray config paths` or
  be retired silently.

## Implementation

- `src/commands/paths.ts` — handler. Reuses `findConfigPath` and
  `findGlobalConfigPath` from `src/lib/config.ts`. Computes
  the cache path with `projectCacheDbPath` from `src/lib/storage.ts` (the
  same helper `src/lib/xray.ts` and `src/commands/clear-cache.ts` use).
- `src/commands/registration/core.ts` — wires the command in via
  `registerPathsCommand(program)`.
- Output: plain text by default (`project-root`, `project-config`,
  `global-config`, `cache-db` — one per line). `--format json` emits a flat
  JSON object suitable for scripting.

## Current state

The strategy is named `config-files` (`xray config-files list|keys|values`).
`config` is a hidden alias group forwarding to the same handlers: absent from
help, `describe`, `--help-all`, strategy lists and the MCP tool list. It is
registered next to the strategy (`RENAMED_STRATEGIES` in
`src/commands/registration/strategies.ts`) and is removed when the CLI goes
stable. The `config` noun stays free for a future introspection group.
