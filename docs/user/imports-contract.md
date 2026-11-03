# Imports Contract (`xray.imports/v1`)

**Status: draft.** The schema and field set below are what
[`xray imports`](#usage) emits. Within v1 they only change additively (see
[Compatibility](#compatibility)); the contract is frozen once the
verification suite lands.

A per-file JSON document listing every import xray can see, with exact
positions and normalized module ids, and an explicit flag on every file
where xray cannot see all reachable modules. Built for tools that treat
imports as evidence (audits, dependency governance), so exactness and
honest coverage take priority over breadth.

## Schema

- JSON Schema 2020-12: `schemas/xray.imports.v1.json`, shipped in the npm
  package (`node_modules/@xray-codes/xray/schemas/xray.imports.v1.json`).
- Every document carries `"schema": "xray.imports/v1"`; pin on it.
- Consumers MUST ignore unknown fields. The schema leaves objects open
  (no `additionalProperties: false`), so a v1 validator keeps accepting
  documents from later v1 releases.

## Usage

```bash
xray imports [paths...] [-p <root>] [--lang <list>] [--format json|yaml|table|csv|text] [-o <file>]
```

`json` (default) and `yaml` print this document; `table`/`csv`/`text`
are views of it. One root per document (`-p`, default the current
directory; `root` echoes it as given); `[paths...]` narrow to files or
directories inside it; `--lang` selects contract languages. Both select
the files reported only: manifests under the root (`go.mod`, `go.work`,
`package.json`, `Cargo.toml`) are always read for resolution. Exit `0`
whenever a document is produced (parse errors and unsupported constructs
are data), `2` on usage errors, `3` when the root or a path does not
exist. Nothing is written into the scanned tree. Full option list:
[Commands: `xray imports`](commands.md#xray-imports).

`xray imports` in `__tests__/fixtures/imports/go/raw-string`:

```json
{
  "schema": "xray.imports/v1",
  "xray": {
    "version": "0.1.0",
    "extractor": "0.3.0"
  },
  "grammars": {
    "go": {
      "module": "tree-sitter-go",
      "version": "0.25.0",
      "source": "xray"
    }
  },
  "root": ".",
  "positions": {
    "line": "1-based",
    "column": "1-based, UTF-16 code units"
  },
  "files": [
    {
      "path": "go/raw-string/main.go",
      "language": "go",
      "sha256": "1d46d478490e0bdceefe2d76d4f5bd396d26302253740396b606a9d9805125eb",
      "status": "ok",
      "complete": true,
      "parseErrors": [],
      "imports": [
        {
          "line": 3,
          "column": 1,
          "endLine": 3,
          "endColumn": 32,
          "kind": "static",
          "form": "import",
          "module": "github.com/example/raw",
          "normalized": "github.com/example/raw",
          "locality": "unknown",
          "confidence": "syntactic",
          "evidence": "import `github.com/example/raw`"
        },
        {
          "line": 6,
          "column": 2,
          "endLine": 6,
          "endColumn": 22,
          "kind": "static",
          "form": "import",
          "module": "example.com/é/v2",
          "normalized": "example.com/é/v2",
          "locality": "unknown",
          "alias": "r",
          "confidence": "syntactic",
          "evidence": "r `example.com/é/v2`"
        },
        {
          "line": 7,
          "column": 2,
          "endLine": 7,
          "endColumn": 22,
          "kind": "static",
          "form": "import",
          "module": "example.com/interp",
          "normalized": "example.com/interp",
          "locality": "unknown",
          "confidence": "syntactic",
          "evidence": "\"example.com/interp\""
        }
      ],
      "unsupported": []
    }
  ],
  "summary": {
    "files": 1,
    "complete": 1,
    "imports": 3,
    "unsupported": 0,
    "parseErrors": 0
  }
}
```

## Document

| Field | Type | Meaning |
|---|---|---|
| `schema` | `"xray.imports/v1"` | Contract id. |
| `xray` | `{version, extractor}` | xray package version; `extractor` semver bumps on any output change for the same input (minor = additive, patch = fix that changes output). Record it next to results. |
| `grammars` | `{<lang>: {module, version, source}}` | Grammar module actually loaded per language present in `files`; `source` says where it was loaded from. Lets you attribute differences to grammar bumps. |
| `root` | string | Scan root as given; every `path` is relative to it. |
| `positions` | object | Fixed conventions: `line` `"1-based"`, `column` `"1-based, UTF-16 code units"` (what editors show). |
| `files` | array | One entry per scanned file, sorted by `path`. |
| `summary` | object | Counts: `files`, `complete`, `imports`, `unsupported`, `parseErrors`. |

### File entry

| Field | Type | Meaning |
|---|---|---|
| `path` | string | Posix path relative to `root`. |
| `language` | string | Detected language. |
| `sha256` | hex string | Content hash: ties the evidence to the bytes read. |
| `status` | enum | `ok`, `parse-error` (imports still listed), `grammar-missing` (grammar not installed), `unsupported-language` (file seen, language outside the contract; never silently dropped). |
| `complete` | boolean | `status` is `ok` and `unsupported` is empty: within xray's model every reachable module is listed. See [Known limits](#known-limits). |
| `parseErrors` | array | `{kind, start, end}` per ERROR (`kind` `error`) or MISSING (`kind` `missing`) node; `start`/`end` are `{line, column}`. |
| `imports` | array | Import records, sorted by (`line`, `column`, `module`). |
| `unsupported` | array | Constructs that can load code xray cannot name, sorted by (`line`, `column`, `construct`). |

### Import record

Required: `line`, `column`, `endLine`, `endColumn`, `kind`, `form`,
`module`, `normalized`, `locality`, `confidence`, `evidence`. The rest are
present only when they apply; an absent boolean means `false`.

| Field | Type | Meaning |
|---|---|---|
| `line`, `column`, `endLine`, `endColumn` | integer | Range of the import (statement or clause), per `positions`; the end is exclusive (`endColumn` is the column just past the last character). |
| `kind` | enum, closed | `static` (declaration syntax), `require` (call form with literal argument: `require`, `require_once`), `dynamic` (`import()`, `__import__`, `import_module` with literal argument), `include` (file inclusion: PHP `include*`, Rust `mod x;`), `reference` (path root or qualified name used in code, no import statement). |
| `form` | string, open | Concrete syntax; see [Forms](#forms). |
| `module` | string | As written, lexically cleaned: quotes, surrounding whitespace, leading `\` (PHP) / `::` (Rust) removed. |
| `normalized` | string or null | Canonical absolute id per [Normalization](#normalization); `null` when not derivable (e.g. Python relative import outside a package). |
| `package` | string | Dependency-level root: crate, top-level package, npm package, Go module, PHP vendor namespace. Absent for relative specifiers. |
| `locality` | enum | `stdlib`, `local` (resolves inside the tree), `external` (declared dependency), `unknown`. |
| `relative` | `{level, module?}` | Python relative imports: `from ..pkg.mod` = `{level: 2, module: "pkg.mod"}`. |
| `alias` | string | Local binding name. Go `.` and `_` kept verbatim. |
| `names` | `[{name, alias?}]` | Imported names (from-import, named import). Names may be attributes, not modules. |
| `wildcard` | boolean | `from m import *`, `export * from`, Rust `::*`. |
| `typeOnly` | boolean | TS `import type`, type-position `import()`. |
| `resolved` | `{file}` or `{dir}` | Target in the tree (`dir` for Go packages); absent when unresolved. |
| `confidence` | enum | `syntactic` (read directly from syntax) or `inferred` (Rust path roots without a leading `::`; filter these if you need certainty). |
| `occurrences` | integer | `kind` `reference` only: uses in the file (first occurrence gives the position). |
| `evidence` | string | Source text, whitespace-collapsed, at most 240 characters. |

### Unsupported record

| Field | Type | Meaning |
|---|---|---|
| `line`, `column` | integer | Start of the construct. |
| `construct` | enum | See table below. |
| `detail` | string | Optional human-readable detail (e.g. linkname target). |
| `evidence` | string | Source text, whitespace-collapsed, at most 240 characters. |

| Language | Constructs |
|---|---|
| Go | `linkname` (`//go:linkname`), `cgo` (`import "C"`), `plugin` (`import "plugin"`) |
| Rust | `build-script` (`build.rs`), `include-macro` (`include!`), `include-data` (`include_str!` / `include_bytes!`) |
| PHP | `eval`, `dynamic-include` (non-literal `require`/`include*`), `dynamic-new` (`new $v`, `new (expr)`), `dynamic-static-call` (`$v::m()`) |
| TS/JS | `dynamic-require`, `dynamic-import`, `create-require` (`module.createRequire`), `eval` |
| Python | `dynamic-import` (non-literal `__import__` / `import_module`), `exec`, `sys-path` (`sys.path` mutation) |

## Forms

Initial list (open; new forms are additive): `import`, `from`,
`export-from`, `import-equals`, `import-type`, `use`, `group-use`,
`use-function`, `use-const`, `extern-crate`, `mod`, `require`, `import()`,
`__import__`, `import_module`, `require_once`, `include`, `include_once`,
`path-root`, `fqn`. Switch on `kind`; treat an unknown `form` as its `kind`.

Record granularity: Rust one record per use-tree leaf; PHP one per `use`
clause (grouped use expanded); Python and TS/JS one per statement, with
`names`.

## Normalization

| Lang | `module` | `normalized` | `package` | `locality` |
|---|---|---|---|---|
| Python | dotted, relative keeps dots | absolute dotted: relative resolved from the file's package (`__init__.py` chain); `null` if file not in a package | first segment of normalized | `stdlib` (vendored `sys.stdlib_module_names`), `local` (resolves in tree), else `unknown` |
| Go | import path unquoted (raw or interpreted) | same | go.mod module path (local) or longest matching `require` path (external); stdlib: first element | `stdlib` (no dot in first element; `C` special), `local` (go.mod / go.work module), `external` (go.mod require), else `unknown` |
| Rust | one leaf path per use-tree leaf, `::` joined, leading `::` stripped | `crate`/`self`/`super` rewritten to `crate::…` when the crate root is known (Cargo.toml + lib.rs/main.rs) | first segment (`crate` for local) | `stdlib` (std/core/alloc/proc_macro/test), `local` (crate/self/super, or root bound by a `mod`/local item), `external` otherwise |
| TS/JS | specifier unquoted | `node:` stripped for builtins; else = module | `@scope/name` or `name`; none for relative | `stdlib` (Node builtin), `local` (relative/absolute), `external` (declared in nearest package.json), else `unknown` |
| PHP | FQN without leading `\`; include path literal | `use`: as written; FQN references: resolved via namespace + use aliases (PHP name-resolution rules); include: `__DIR__ . 'x'` folded | first namespace segment | `local` for resolved include files; else `unknown` (no psr-4 in v1) |

Path aliases (tsconfig `paths`/`baseUrl`) are not applied: such specifiers
stay `unknown`.

### Languages and forms

| Language | Extensions | Static forms |
|---|---|---|
| `typescript` | `.ts`, `.tsx` (tsx grammar), `.mts`, `.cts` | `import`, `export-from`, `import-equals` |
| `javascript` | `.js`, `.jsx`, `.mjs`, `.cjs` | `import`, `export-from` |
| `python` | `.py` | `import`, `from` |
| `go` | `.go` | `import` |
| `rust` | `.rs` | `use`, `extern-crate`, `mod` (kind `include`), `path-root` (kind `reference`) |
| `php` | `.php` | `use`, `group-use`, `use-function`, `use-const`, `require`, `require_once`, `include`, `include_once`, `fqn` (kind `reference`) |

Extensions no entry claims are omitted from `files`; a claimed extension
whose grammar is not installed gives `status: grammar-missing`.

TS/JS bindings: a default import is the name `default` aliased to the local
(`import d from 'm'` = `names: [{name: "default", alias: "d"}]`); a
namespace import, `export * as ns from` and `import x = require()` set
`alias`; `export * from` sets `wildcard`. `typeOnly` is set for
`import type` / `export type` statements only (an inline
`import { type A }` keeps the module load). Import attributes
(`with {...}`) are ignored. `node:` specifiers are `stdlib` with the
prefix stripped from `normalized`.

Python: `import a.b as c, d` gives one record per module (range = the
clause, `evidence` = the statement); `from` imports give one record per
statement with `names`. Relative imports keep `normalized: null` until
package resolution applies.

Go: one record per `import_spec` (range = the declaration for a single
`import "x"`, the spec inside a group); alias, `.` and `_` go to `alias`
verbatim; raw (backtick) paths are unquoted; `import "C"` is a plain
static record.

Rust: use trees are flattened to one record per leaf (`self` leaf = its
prefix, `as` -> `alias`, `*` -> `wildcard`, leading `::` stripped and its
first segment set as `package`). Range = the declaration when it yields one
record, else the leaf; `evidence` = the declaration. `crate`/`self`/`super`
paths get `package: "crate"`, `locality: "local"` (`normalized: null` for
`self`/`super`). `extern crate x [as y]` and `mod x;` (no body) are
emitted; a `#[path]` attribute above `mod x;` is included in its range and
evidence.

Rust references (`path-root`): the root of each path used in code outside
`use` / `extern crate` — expressions, patterns, types, impl headers,
qualified types (`<T as tokio::io::AsyncRead>`), macro and attribute paths
(`log::info!`, `#[tokio::main]`) — plus a token scan of attribute and macro
arguments and `macro_rules` bodies (an identifier followed by `::`, not
preceded by `::` or `.`). Skipped: `crate`/`self`/`super`/`Self`/`$crate`
and metavariable roots, CamelCase roots (types, enum variants), primitive
types (`u32::MAX`), and roots bound in the file by a `use` leaf (its alias
or last segment), `extern crate` (alias or name), `mod` or a named item.
`::x` always names a crate: `confidence: syntactic`, never shadowed by a
binding; other roots are `inferred`. Locality per Resolution
(`std`/`core`/`alloc`/`proc_macro`/`test` = `stdlib`, else `external`).
`module` = `normalized` = `package` = the root.

PHP: one record per `use` clause, grouped use expanded with its prefix,
FQN without leading `\`, `package` = first namespace segment. `require` /
`include*` only with a literal path: a quoted string without
interpolation (optionally parenthesised) or `__DIR__ . '/lit'` (folded
against the file's directory in `normalized`); `module` keeps escapes as
written, `normalized` is the unescaped value. Range = the declaration when
it yields one record, else the clause; `evidence` = the statement.

Call forms (TS/JS, Python), at any depth, only with a literal argument:
a string or substitution-free template string (TS/JS); a `str` literal
without interpolation, or a concatenation of such (Python). Escape
sequences are not decoded: an argument with one is not literal.
- `require('m')`: kind `require`, form `require`. Only while `require` is
  the global: any binding of the name in the file (declaration,
  parameter, destructuring, import, assignment; TS `declare` excluded)
  disables these records file-wide.
- `import('m')`: kind `dynamic`, form `import()`. TS type-position
  `import('m').T` (`type`, annotations, `typeof`, `as`): kind `static`,
  form `import-type`, `typeOnly` (erased at compile time).
- `__import__('m')`: kind `dynamic`, form `__import__`, unless the file
  rebinds `__import__`; literal `level=N` > 0 sets `relative`.
- `import_module('m'[, package])`: kind `dynamic`, form `import_module`,
  through a binding made by an import in the same file (`import importlib`,
  `import importlib as il`, `from importlib import import_module [as f]`).
  Relative names: literal `package` -> `normalized` per importlib's
  `resolve_name` (no `relative`); `package=__package__` -> `relative` as
  for `from .`; `package=__name__` -> `relative` rewritten to the
  package-relative form (`.a` in `pkg/mod.py` = `{level: 1, module:
  "mod.a"}`; in `__init__.py` `__name__` is the package).
Range and `evidence` = the call. Bindings are file-wide, not scope-aware.

PHP references (`fqn`): every qualified name outside `use` clauses (`new`,
static and function calls, `instanceof`, types, `X::class`, attributes,
trait `use`), resolved per PHP rules: leading `\` = fully qualified
(`module` without it); `namespace\X` = current namespace; a first segment
matching a class `use` alias of the same namespace block (case-insensitive;
`use function` / `use const` do not apply) = alias target; else prefixed by
the current namespace. Unqualified names are skipped. All are `syntactic`:
PHP's name-resolution rules make the result deterministic. `normalized` = the
resolved name, `package` = its first segment.

References (both languages): one record per root (Rust) or resolved name
(PHP) per file; the first occurrence gives the range and `evidence` (the
path / name text), `occurrences` counts every use.

Not yet emitted: non-literal or shadowed call forms (reported as
`unsupported` later); non-literal PHP includes; `parseErrors` and
`unsupported`.

### Resolution

A pass after extraction sets `locality`, `package`, `resolved` and, where
only the file tree can derive it, `normalized`. It sees only the scanned
file set: manifests must be part of it (`go.mod`, `go.work`,
`package.json`; `Cargo.toml` and `__init__.py` as markers). No filesystem
or network access, no `node_modules`: `external` means declared by a
manifest, not installed. Every record kind goes through the same rules.

| Lang | Rules |
|---|---|
| TS/JS | Node builtin (`module.builtinModules` of the running Node; `node:`-only builtins such as `node:test` need the prefix) -> `stdlib`. Relative / absolute (root-relative) -> `local`, `resolved.file` by exact path, `.ts .tsx .js .jsx .mjs .cjs`, then `/index.*` (the graph builder's rules). Bare specifier whose package is the `name` of a package.json in the tree -> `local`, `resolved.dir` (subpath: `resolved.file` when it resolves). Declared in the nearest package.json (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`) -> `external`. Else `unknown`. |
| Python | Package from the `__init__.py` chain (a chain reaching the scan root has no known name). Relative -> absolute `normalized`, `local`; too many levels or no package -> `normalized: null`, `unknown`. First segment in CPython 3.13 `sys.stdlib_module_names` -> `stdlib`. Absolute resolving to `<r>/a/b.py` or `<r>/a/b/__init__.py` for r = package root, scan root, `src/` -> `local` + `resolved.file`. Else `unknown`. |
| Go | Under a go.mod module of the tree (longest module path; a go.work narrows the set to its `use` entries) -> `local`, `package` = module path, `resolved.dir` when the directory holds a scanned `.go` file. First element without a dot -> `stdlib` (`C` stays `unknown`). Longest `require` of the file's own go.mod -> `external`, `package` = that module. Else `unknown`. |
| Rust | Crate root = nearest Cargo.toml with `src/lib.rs` or `src/main.rs`; module path from the file's place under `src/` (not `src/bin/`). `self`/`super` -> `crate::…` (null when unknown or above the root). `mod x;` -> `crate::<module>::x`, `resolved.file` = `#[path]` (relative to the file's directory) or `x.rs` / `x/mod.rs`. `std`/`core`/`alloc`/`proc_macro`/`test` -> `stdlib`. Root declared by a `mod x;` in the same file -> `local`. Else `external`, `package` = first segment (inline modules and other local items are not seen). |
| PHP | Literal include: `__DIR__ . '/x'` as folded, other relative literals against the including file's directory -> `local` + `resolved.file` when scanned. Absolute paths, stream wrappers, `use` and FQN references -> `unknown`. |

## Ordering and determinism

`files` by posix `path`; `imports` by (`line`, `column`, `module`);
`unsupported` by (`line`, `column`, `construct`); `parseErrors` by
`start`. The same input and xray version produce byte-identical output.

## Compatibility

Additive within v1 (no version bump):
- a new optional field;
- a new `form` value;
- a new `construct` value (treat an unknown construct as "file not
  complete", which `complete` already says);
- a new `status` value, only behind a new opt-in flag.

Breaking (requires `xray.imports/v2`):
- removing or renaming a field, or making an optional field required;
- adding, removing or changing a `kind`, `locality` or `confidence` value;
- changing the `positions` conventions;
- changing the normalization of an existing form.

The `extractor` version changes whenever output changes for the same input,
even within these rules; record it with results if you diff runs.

## Known limits

`complete: true` means complete within xray's model, not that nothing else
can be loaded. Not seen in v1:
- Rust macro expansion; PHP autoload through strings (`'Vendor\\X'`,
  `class_exists($x)`); Python entry points / plugins; `TYPE_CHECKING`
  guards.
- Conditional compilation (Go build tags, Rust `cfg`), `//go:embed` data.
- Resolution: tsconfig `paths`/`baseUrl`, package.json `exports`/`imports`
  maps, composer psr-4, Cargo dependency tables / workspaces,
  pyproject / site-packages. Affected records stay `unknown`.
- Rust path roots (except `::x`) are `inferred`: false
  positives (e.g. glob-imported names) and misses inside unusual macro token
  trees are possible.
- Languages: Python, Go, Rust, TS/JS, PHP. Other files are listed as
  `unsupported-language`. Single root per document.
