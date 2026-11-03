# Imports Contract (`xray.imports/v1`)

**Status: draft.** The schema and field set below are the target for the
upcoming `xray imports` command. Within v1 they only change additively (see
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
| `confidence` | enum | `syntactic` (read directly from syntax) or `inferred` (Rust path roots, PHP relative-qualified names; filter these if you need certainty). |
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
| Rust | one leaf path per use-tree leaf, `::` joined, leading `::` stripped | `crate`/`self`/`super` rewritten to `crate::…` when the crate root is known (Cargo.toml + lib.rs/main.rs) | first segment (`crate` for local) | `stdlib` (std/core/alloc), `local` (crate/self/super, or root bound by a `mod`/local item), `external` otherwise |
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
| `rust` | `.rs` | `use`, `extern-crate`, `mod` (kind `include`) |
| `php` | `.php` | `use`, `group-use`, `use-function`, `use-const`, `require`, `require_once`, `include`, `include_once` |

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

PHP: one record per `use` clause, grouped use expanded with its prefix,
FQN without leading `\`, `package` = first namespace segment. `require` /
`include*` only with a literal path: a quoted string without
interpolation (optionally parenthesised) or `__DIR__ . '/lit'` (folded
against the file's directory in `normalized`); `module` keeps escapes as
written, `normalized` is the unescaped value. Range = the declaration when
it yields one record, else the clause; `evidence` = the statement.

Not yet emitted: call forms (`require()`, `import()`, `__import__`,
`importlib.import_module`); non-literal PHP includes; `locality` other
than `unknown`, except `stdlib` for `node:` and `local` for Rust
`crate`/`self`/`super`/`mod`; `resolved`; `parseErrors` and
`unsupported`.

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
- Rust path roots and PHP relative-qualified names are `inferred`: false
  positives (e.g. glob-imported names) and misses inside unusual macro token
  trees are possible.
- Languages: Python, Go, Rust, TS/JS, PHP. Other files are listed as
  `unsupported-language`. Single root per document.
