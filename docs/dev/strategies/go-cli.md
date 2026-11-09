# Go CLI Strategy

Detects Go command-line applications and extracts their command tree: names, hierarchy, short
descriptions, and flags. Frameworks: `spf13/cobra`, `urfave/cli` (v1-v3), and kit
(`hop.top/kit`, which sits on cobra).

## Detection

A project matches when any of these hold:

1. `go.mod` mentions `github.com/spf13/cobra`, `github.com/urfave/cli` or `hop.top/kit`
2. a `cmd/**/*.go` tree exists
3. any Go file imports one of those frameworks or `hop.top/kit/...`
4. a file with `func main()` imports the standard `flag` package (detected only; commands and
   flags of the `flag` package are not extracted)

## Usage

```bash
xray go-cli commands                      # text tree, static AST analysis (default)
xray go-cli commands --format json        # stable, sorted JSON
xray go-cli commands -p /path/to/repo

# opt-in: ask the real binary (kit toolspec), see "Trust model"
xray go-cli commands --exec-binary        # build the main package, run `spec --format json`
xray go-cli commands --binary ./bin/tool  # run a binary you supply
xray go-cli commands --exec-binary --allow-cgo           # builds needing cgo (runs the C toolchain)
xray go-cli commands --exec-binary --unsafe-no-sandbox   # only if no OS sandbox exists
```

`XRAY_GO_CLI_EXEC=1` in the *user's* environment is equivalent to `--exec-binary`; `XRAY_GO_CLI_CGO=1` to `--allow-cgo`.

The `source` field (and the text header) says which path produced the result.

## Sources

### `ast` (default)

Static analysis of the Go source with tree-sitter-go. Nothing is built or executed.

Extracted:

- cobra: `&cobra.Command{Use, Short, Long, Aliases, Hidden, Deprecated}` literals (string
  constants and `"a" + b` concatenations are resolved); the command name is the first word of
  `Use`
- hierarchy from `X.AddCommand(...)`, where `X` and the children may be package variables, local
  variables, constructor calls (`newFooCmd()`, `pkg.NewCmd()`, resolved through the function's
  `return`) or inline literals; works across files and packages
- flags from `Flags()` / `PersistentFlags()` calls, including a stored `f := cmd.Flags()`:
  `String`, `StringP`, `StringVar`, `StringVarP`, `Bool`, `Int`, `Duration`, `Count`, slices,
  maps, `Var`, `Func`, ...; name, shorthand, type, default, usage, persistent
- urfave: `cli.App` / `cli.Command` literals with nested `Commands`/`Subcommands` (inline or by
  identifier) and `Flags: []cli.Flag{&cli.StringFlag{...}}` (name, first one-letter alias as
  shorthand, usage, default)
- kit: the root cobra command is created inside kit (`var rootCmd = root.Cmd`). Anything wired
  to a root-looking reference becomes children of one synthetic root named after
  `cli.Config{Name: ...}`

Limits (best effort, reported as `warnings`): commands built by helper functions that take the
name as a parameter, reflection, dynamic registration in loops, and `AddCommand` receivers that
are function parameters are not resolved; such commands may appear as separate roots
("unattached command") or be missing. Hidden/kit-reserved commands appear when they exist in
source. If `tree-sitter-go` is not installed (optional language pack) the AST path is skipped
with a warning and an empty result; it never throws.

### `toolspec` (opt-in)

kit CLIs expose `<tool> spec --format json`, a machine-readable manifest. xray parses it:

```json
{ "tool": "demo", "version": "0.1.0", "schema_version": "1.0",
  "commands": [ { "path": ["demo","item","add"], "short": "Add an item",
                  "side_effect": "write", "idempotent": "no", "retryable": false,
                  "dry_run_supported": true, "flags": [ {"name":"force","type":"bool"} ] } ] }
```

The manifest lists leaf commands only; group nodes are synthesized from `path`. In addition to
the AST fields, each command gets `safety`: `sideEffect`, derived `level`
(`read`->`safe`, `write*`/`interactive`->`caution`, `destructive*`->`dangerous`), `idempotent`,
`retryable`, `dryRunSupported`, `destructiveTokenRequired`, `exitCodes`. The nested `ToolSpec`
tree shape (`name` + `children`) is also accepted. kit's `spec` command itself, `help` and
`completion` are omitted from the tree.

If the toolspec cannot be obtained (execution not allowed, no sandbox, build failure, no `spec`
command, non-JSON output, timeout) xray falls back to the AST path and says why in `warnings`.
Most hop.top tools do not expose kit's standard `spec` yet and therefore use the fallback.

## Trust model

Building and running a repository's code is arbitrary code execution (cgo, init code, the CLI's
own startup). A temp HOME is not isolation. So:

- **Default is static.** No `go build`, no subprocess. Nothing found in the scanned repo
  (including `.xrayrc.json` and other repo-local config) can turn execution on. Only the user can:
  `--exec-binary`, `--binary <path>`, or `XRAY_GO_CLI_EXEC=1` in their own environment.
- **Always sandboxed.** macOS: `sandbox-exec` with a profile that denies network, denies all
  writes except a private temp dir (plus the build cache for the build step), and denies reads of
  the user's home except an explicit allow list (see Build hardening; for the run step only the
  binary and the temp dir). Linux: `bwrap` with `--unshare-net`, private `/tmp` and
  `/home`, read-only binary. The Linux profile follows the same contract and is
  exercised in CI (ubuntu-latest). Ubuntu 24.04 restricts unprivileged user namespaces
  (`kernel.apparmor_restrict_unprivileged_userns=1`); until `bwrap` is allowed one
  (an AppArmor profile granting `userns` to `/usr/bin/bwrap`, see `.github/workflows/ci.yml`),
  sandboxed builds fail with `bwrap: loopback: Failed RTM_NEWADDR` and xray falls back to AST.
- **Build hardening.** `CGO_ENABLED=0` by default: cgo lets repo code drive the C toolchain
  (clang/gcc) during the build, so it is enabled only by the user (`--allow-cgo` or
  `XRAY_GO_CLI_CGO=1`; never by repo config). Trade-off: packages that need cgo-tagged files
  (tlc's `handle.ErrUnsupported`, for example) fail to build by default; xray then reports
  "build needs cgo; rerun with --allow-cgo" and falls back to AST. Other settings: `GOPROXY=off`,
  `GOFLAGS=-mod=readonly` (or `-mod=vendor`), `GOTOOLCHAIN=local`; `GOROOT`/`GOBIN` are not
  passed (a shell `GOROOT` for another toolchain breaks the build); the build env is scrubbed
  (no inherited secrets). Reads of the user's home are denied for the build too, except
  `GOROOT`, the `go` binary's directory, `GOMODCACHE`, the xray build cache, the repo root and the
  private temp dir (plus, only with `--allow-cgo`, the C toolchain: Command Line Tools / Xcode,
  `xcrun --show-sdk-path`, `/usr/lib`, `/usr/include`). Consequence: `replace` directives or
  `go.work` entries pointing outside the repo root fail the build (and fall back to AST). On
  Linux bwrap only those paths are mounted read-only instead of the whole filesystem. Writes are
  confined to the private temp dir plus one xray-managed build cache,
  `$XDG_CACHE_HOME/xray/go-cli/<hash of repo path>/gocache` (`~/Library/Caches` on macOS,
  `~/.cache` elsewhere), one per scanned repo so repeat runs are fast and a hostile build can only
  poison later xray builds of that same repo. The user's own `GOCACHE` is never touched. The
  module cache is read-only. Build timeout 15 min.
- **Run hardening.** Command is exactly `<bin> spec --format json`, scrubbed environment (no
  inherited secrets; temp HOME/XDG dirs, `NO_COLOR=1`), temp cwd, stdin closed, 15 s timeout,
  process group killed on timeout.
- **No sandbox tool, no execution.** Without `sandbox-exec`/`bwrap`, xray refuses and uses AST.
  `--unsafe-no-sandbox` overrides this (with a warning in the output).
- **Fail closed.** Any failure falls back to AST.

## Output

Text:

```
cobrademo commands [source: AST (tree-sitter-go)]
cobrademo  Demo cobra CLI  (cmd/root.go:15)
│    -c, --config <string>  config file
├─ deploy  Deploy the application  (cmd/deploy.go:5)
│  └─ rollback  Roll back a deploy  [hidden]  (cmd/deploy.go:11)
└─ serve  Start the server  (internal/serve/serve.go:6)
```

JSON (`--format json`; commands sorted by path, flags by name, empty optionals omitted):

```json
{ "source": "ast", "tool": "cobrademo",
  "commands": [ { "path": ["cobrademo","deploy"], "short": "Deploy the application",
                  "aliases": ["ship"], "flags": [ {"name":"replicas","type":"int","default":"1"} ],
                  "file": "cmd/deploy.go", "line": 5 } ],
  "warnings": [] }
```

`file`/`line` appear for `ast`, `safety` for `toolspec`.

## Per-file metadata (`analyze`)

For `xray map` / `explore`, each Go file that defines commands is tagged and annotated:

| Tag | Meaning |
| --- | --- |
| `go-cli:command` | file defines command literals |
| `go-cli:flags` | file defines flags |
| `go-cli:hierarchy` | file wires `AddCommand` / nested subcommands |
| `go-cli:urfave-app` | file defines a `cli.App` |

Metadata: `commands` (`name`, `short`, `framework`, `line`, `flags` count), `commandName`,
`commandShort`, `commandLong`, `flags` (`name`, `type`, `usage`, `shorthand`), `appName`,
`appUsage`. When `tree-sitter-go` is missing, `metadata.astSkipped` is set instead.

## File types and ignores

`.go`; ignores `**/*_test.go`, `**/vendor/**`, `**/testdata/**`.

## Implementation

`strategies/go-cli.ts` (strategy), `src/lib/strategy/go-cli/`: `ast.ts` (extraction + linking),
`toolspec.ts` (manifest parser), `binary.ts` (opt-in build/run + sandbox), `model.ts` (shared
model, JSON/text renderers).

## Version

**0.2.0**: `commands` subcommand; kit detection; AST and opt-in toolspec sources.
