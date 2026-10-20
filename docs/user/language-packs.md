# Language Packs

xray parses code with [tree-sitter](https://tree-sitter.github.io) grammars. Grammars are
**optional, opt-in packs**: the core install only depends on `tree-sitter`, so you
only pay install / native-build cost for the languages you use.

## Quick start

```bash
npm install -g @xray-codes/xray
xray lang list             # what is installed, what your repo needs
xray lang add go typescript
xray map
```

With nothing configured xray auto-detects: it parses every file whose language has
an installed grammar, and prints one warning per missing language, then carries on:

```
⚠ skipping 12 .kt files: grammar not installed — run `xray lang add kotlin`
```

xray never installs anything implicitly during a scan. Exit code is unchanged by
skipped languages.

## Commands

| Command | Purpose |
|---------|---------|
| `xray lang list [--path p] [--json]` | Packs, status (installed / not installed / broken), source, file counts in the repo, bundles |
| `xray lang add <names...> [--dry-run]` | Install languages or bundles into the xray-managed dir (npm; native build only if no prebuilt binary) |
| `xray lang remove <names...>` | Remove packs from the managed dir (never touches grammars from other installs) |

Languages: typescript, javascript, python, java, csharp, cpp, c, go, rust, php, ruby,
bash, swift, kotlin, scala, elixir, haskell (aliases such as `ts`, `py`, `rb`, `rs`, `c-sharp` work).

Bundles: `web` (typescript, javascript), `go`, `systems` (c, cpp, rust, go),
`jvm` (java, kotlin, scala), `scripting` (python, ruby, php, bash), `full` (everything).

## Choosing languages in config

```json
{ "languages": ["go", "typescript"] }
```

in `.xrayrc.json` restricts parsing to those languages (other files are skipped
silently). Listed languages are **required**: if one of their grammars is missing,
the run fails with a message naming the fix. Bundles are accepted too (`"languages": ["web"]`).

One-off override from the command line (replaces config `languages`; comma-separated or repeated):

```bash
xray map --lang go,ts
```

Unknown names exit 2; a required language whose grammar is missing exits 3.

## Where grammars are resolved from

In order:

1. xray's own install (also covers a source checkout / dev setup, where grammars are `devDependencies`).
2. The xray-managed dir populated by `xray lang add`:
   `$XRAY_LANG_DIR`, else `$XDG_DATA_HOME/xray/lang`, else the platform data dir
   (`~/Library/Application Support/xray/lang` on macOS, `~/.local/share/xray/lang` on Linux).

The scanned repository's own `node_modules` is **not** searched: loading a grammar
runs native code, and scanning an untrusted repo must not execute that repo's code.
If you really want it, set `XRAY_ALLOW_PROJECT_GRAMMARS=1` in your environment (never
via repo config); xray then warns with the resolved path. The managed dir can only be
redirected by environment variables, never by repo-local config.

## Strategies

A strategy that needs a grammar declares it (`requiresLanguages = ['go']`). If the
strategy otherwise applies to the repo but the grammar is absent, it is not
detected and one warning explains how to add it.

## Migration

Previously every grammar was installed with xray. Existing users who want the old
behaviour: `xray lang add full`. Otherwise run `xray lang list` in your repos and
add what you need. Cached results are unaffected; files skipped for lack of a
grammar are never cached, so adding a grammar takes effect on the next run.

## Packaging notes (maintainers)

Grammars are `peerDependencies` marked optional (`peerDependenciesMeta`), plus
`devDependencies` so the test suite can exercise them. npm does not install optional
peers, unlike `optionalDependencies`, which are installed by default. The catalog in
`src/lib/parser/grammars.ts` must match `package.json` ranges (enforced by a test).
Testing aid: `XRAY_LANG_BLOCK=python,java` makes those grammars behave as not installed.
