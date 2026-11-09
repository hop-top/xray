# Logging

How xray logs and styles terminal output. Supersedes the earlier review of
the old logger; its chalk-based findings were removed as no longer current
after the `@hop-top/kit` migration.

**Files:** `src/lib/logger.ts`, `src/lib/tui.ts`, `src/commands/root-options.ts`,
`src/index.ts`

## Streams

- **stderr**: every diagnostic line (`Logger.debug/info/success/warn/error/log`).
- **stdout**: data only (`Logger.output`, formatter output, completion scripts).
  Pipes and `--json`/`--csv` output stay free of diagnostics.

## Logger

`Logger` is a static facade over kit's logger (`@hop-top/kit/log`, loaded on
the first log line). Kit owns level filtering and dispatch; xray owns the line
format and the threshold.

```typescript
Logger.debug(message, ...args)   // ◆  formatted with util.format when args given
Logger.info(message)             // ℹ
Logger.success(message)          // ✔
Logger.warn(message)             // ⚠
Logger.error(message, error?)    // ✖  error detail printed as a second line
Logger.log(message)              // info level, no glyph
Logger.output(message)           // stdout, unfiltered; command results only
```

Levels: `silent`, `error`, `warn`, `info` (default), `debug`.

## Level resolution

The root `preAction` hook (and an earlier argv scan in `src/index.ts`, so
start-up work is covered) picks the level, first match wins:

1. `--quiet` -> `error` (errors only; beats `-V` and `--log-level`)
2. `--log-level <level>` -> that level (invalid value is a usage error, exit 2)
3. `-V` / `--verbose` (stackable; any count) -> `debug`
4. otherwise `info`

`-v` is `--version`, not verbosity. Kit's own `quiet` mode (warn + error) is
not used.

## Color policy

`src/lib/tui.ts` decides per stream, first match wins:

1. `--no-color` -> off
2. `NO_COLOR` set -> off
3. `FORCE_COLOR` set (not `0`/`false`) -> on
4. stream is a TTY -> on, else off

Styling comes from kit's TUI theme; xray no longer depends on `chalk`.

## Progress

Progress bars come from `src/lib/tui.ts` (kit TUI; `cli-progress` was removed). No
progress output under `--quiet` or on a non-TTY stream (no redraws in pipes or
CI logs). With color on the kit bar is used; with color off a plain bar with
the same glyphs and no ANSI.

## Direct console use

Intended `console.*` use outside `Logger`:

- stdout data: formatter output, `Logger.output`, completion scripts
- `src/lib/telemetry-consent.ts`: interactive consent prompt (styled through
  `tui.ts`)
- `src/lib/events/async-emitter.ts`: last-resort error in the error handler
  (avoids recursion)
- `src/lib/error/*`: error-reporting utilities and JSDoc examples
- `src/lib/logger.ts`: the sink itself (`console.warn` for warn lines,
  `console.error` otherwise; both stderr)

Command code reports status through `Logger`; new diagnostics should not call
`console.*` directly.

## Removed dependencies

Removed in the kit migration: `chalk`, `cli-progress`, `@hop/upgrade-ts`, direct `better-sqlite3` use.
The SQLite analysis cache goes through kit's sqlstore.

## Open items

- No structured (JSON) log output; lines are human-readable only.
- No file sink or timestamps.
