# Language Packs

xray parses code with [tree-sitter](https://tree-sitter.github.io) grammars. Grammars are
**optional, opt-in packs**: the core install only depends on `tree-sitter`, so you
only pay install / native-build cost for the languages you use.

## Quick start

```bash
npm install -g @hop-top/xray
xray lang list             # what is installed, what your repo needs
xray lang add go typescript
xray map
```

With nothing configured xray auto-detects: it discovers files in every catalog
language, parses those whose grammar is installed, and prints one aggregated hint
(stderr) for the rest, then carries on:

```
ℹ found 12 .kt, 3 .swift files without installed grammars — install with: xray lang add kotlin swift
```

The hint shows for human output (the default). Machine formats (`--format json|csv|xml`,
or the `--json`, `--csv`, `--xml` aliases) keep it quiet unless verbose (`-V`), where per-language counts and sample
paths are listed too; `--quiet` always hides it. `xray lang list` shows the same
languages under "Detected in this repo, not installed" (`detectedNotInstalled` in
`--json`).

xray never installs or builds anything implicitly during a scan. Exit code is
unchanged by skipped languages.

## Commands

| Command | Purpose |
|---------|---------|
| `xray lang list [--path p] [--format text|json]` | Packs, status (installed / not installed / broken), source, file counts in the repo, bundles |
| `xray lang add <names...> [--dry-run]` | Install languages or bundles into the xray-managed dir (npm; native build only if no prebuilt binary) |
| `xray lang remove <names...>` | Remove packs from the managed dir (never touches grammars from other installs) |

After installing, `xray lang add` checks each new grammar against xray's own
tree-sitter (`setLanguage` plus a small parse). A grammar that installs and loads
but is rejected (for example built for a newer tree-sitter ABI than xray supports)
is reported per language, e.g. `go: installed but not usable with xray's tree-sitter
0.25.1 (Incompatible language version. Compatible range: 13 - 15. Got: 16)`, and the
command exits 1. The package stays in the managed dir; install another release there
or run `xray lang remove <name>`.

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

## Packaging notes (maintainers)

Grammars are `peerDependencies` marked optional (`peerDependenciesMeta`), plus
`devDependencies` so the test suite can exercise them. npm does not install optional
peers, unlike `optionalDependencies`, which are installed by default. The catalog in
`src/lib/parser/grammars.ts` must match `package.json` ranges (enforced by a test).
Testing aid: `XRAY_LANG_BLOCK=python,java` makes those grammars behave as not installed.
