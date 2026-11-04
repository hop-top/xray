# Testing

## Running

```bash
npm test                      # every suite, one process each (recommended)
npm test -- <file-or-pattern> # subset, same guard rails
npm run test:coverage         # single process, coverage on (some tree-sitter failures expected)
npm run test:parallel         # plain jest, no guard rails (CI only)
```

`npm run build` / `tsc` is the type gate; the test run only transpiles (see
"ts-jest" below).

## Why one process per suite

Tree-sitter's native bindings keep global state that is corrupted when
different grammars load in one Node process. No Jest option fixes that (it
happens below the module system), so `scripts/test-sequential.sh` runs
`jest <file>` per suite. The cost: a fresh Node + ts-jest start per suite,
and the runner owns process hygiene, because nothing else will.

## Guard rails in `scripts/test-sequential.sh`

| Guard | Behavior |
|-------|----------|
| Machine-wide lock | `${TMPDIR}/xray-test.lock` (atomic `mkdir`, holder PID inside). A second `npm test` from any worktree waits with a visible message instead of stacking. Stale locks (dead PID) are reclaimed. |
| Process group per suite | Each suite starts in its own session (`setsid`), tagged `XRAY_TEST_RUN_ID=<id>` in its env. |
| Reap after each suite | Pass, fail, or timeout: whole group TERM, short grace, KILL. |
| Leaks fail the run | Survivors found after a suite exits are killed **and** the run exits non-zero naming the suite and the processes. Fix the test; the runner does not hide it. |
| Per-suite timeout | Wall-clock limit; the group is killed and the suite counts as failed. |
| Heap cap | `NODE_OPTIONS=--max-old-space-size=N` for the suite and every Node child it starts. A runaway suite dies with a V8 OOM instead of eating the machine. |
| Peak RSS | Per-suite peak RSS (`/usr/bin/time`), top N printed in the summary. |
| Memory pressure | On macOS the run waits (bounded) while the kernel reports critical memory pressure. |

Leak detection unions three signals, because each alone misses cases:
process-group membership, the env tag (platform binaries such as `sleep`
hide their env from `ps`), and a descendant tracker
(`scripts/lib/track-descendants.pl`) that records the process tree while the
suite runs (catches `detached`/`setsid` children that re-parent to launchd).
A child that is double-forked and dies between polls is not tracked; that is
harmless by definition.

### Env knobs

| Variable | Default | Meaning |
|----------|---------|---------|
| `XRAY_TEST_MAX_OLD_SPACE_MB` | `2048` | V8 old-space cap per suite process |
| `XRAY_TEST_SUITE_TIMEOUT_S` | `300` | wall-clock limit per suite |
| `XRAY_TEST_KILL_GRACE_S` | `2` | TERM to KILL grace |
| `XRAY_TEST_MEM_REPORT` | `10` | top-N peak-RSS lines in summary (`0` = off) |
| `XRAY_TEST_NO_LOCK` | unset | `1` skips the machine-wide lock |
| `XRAY_TEST_LOCK_DIR` | `${TMPDIR}/xray-test.lock` | lock location |
| `XRAY_TEST_LOCK_TIMEOUT_S` | `3600` | give up waiting for the lock (`0` = forever) |
| `XRAY_TEST_PRESSURE_WAIT_S` | `300` | max wait on critical memory pressure (`0` = off) |

## Linux and CI

The runner is portable: peak RSS comes from GNU `time -v` (BSD `-l` on macOS),
`ps -axeww` and `setsid` work as-is, and the memory-pressure wait is macOS-only.
CI (`.github/workflows/ci.yml`, job `test`) runs `npm test` on ubuntu-latest (x64) for
Node 26 and 22 (about 6 minutes of suites each, ~8 minutes per job) plus one
ubuntu-24.04-arm (arm64) leg on Node 22, with `XRAY_TEST_NO_LOCK=1`, and uploads
the log on failure. Each job installs Go, bubblewrap (plus an AppArmor `userns` grant
for `bwrap`; see `docs/dev/strategies/go-cli.md`) and a pinned `mdq`, so the
go-cli sandbox suites and the markdown strategy suites run instead of skipping.

`mdq` version is pinned in one place: `MDQ_VERSION` in `src/utils/mdqInstall.ts`
(CI reads it from there). Upstream ships prebuilt assets for linux-x64, macos-arm64
and windows-x64 only. x64 legs download the release tarball and check its sha256
(update `MDQ_SHA256` in the workflow when bumping the version); the arm64 leg runs
`cargo install mdq --version <pin> --locked`, with `~/.cargo/bin/mdq` cached by
version, so a cache hit skips the build. macOS: `brew install mdq`; linux-arm64 and
macos-x64 have no prebuilt asset, so use cargo there. When `mdq` is absent xray logs
an info-level, platform-specific install hint (`mdqInstallHint`) and the markdown
strategy is not detected.

To reproduce locally on a Linux container: use Ubuntu 24.04 with Node, Go, `git`, `perl`,
`procps`, `time`, `bubblewrap`; copy the tree (not host `node_modules`), then
`npm ci && npm run build && XRAY_TEST_NO_LOCK=1 npm test`. Docker masks
`/proc`, so the bwrap suites need `--security-opt systempaths=unconfined`
(plus `seccomp=unconfined`, `apparmor=unconfined`) and `--init` (otherwise the runner reports reaped bwrap children as `<defunct>` leaks). That is a container limit, not
product behavior.

Tests must not assume directory-entry order, a wall-clock lower bound on a timer
(timers can fire ~1ms early), or sub-jiffy distinct mtimes: Linux filesystems differ
from APFS on all three.

## Writing tests that spawn processes

- Every child you start must be gone when the suite ends. Kill it in
  `afterEach`/`afterAll` (and on timeout paths), not just on the happy path.
- `detached: true` children are in their own group: kill with
  `process.kill(-child.pid)`.
- Servers: close them in `afterAll`; unref timers.
- Put cleanup in `finally`/`afterAll`, so a failed assertion cannot skip it.
- If the runner prints `[LEAK]`, that is the bug report: it names the suite
  and the command line that survived.

## ts-jest

See `jest.config.js`. Suites are transpiled only (`tsconfig.jest.json` sets
`isolatedModules`): peak RSS per suite process drops from ~500MB to ~200MB and
cold start roughly halves. Type errors no longer fail a suite, so the gates are
`npm run build` (src) and `npm run typecheck:tests` (tests). Coverage is off
so a bare `jest` does not instrument every file; `npm run test:coverage`
turns it on.
