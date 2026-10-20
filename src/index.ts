#!/usr/bin/env node
import { registerCommands } from './commands';
import { initializeTelemetry, shutdownTelemetry } from './lib/telemetry';
import { loadConfig } from './lib/config';
import { handleFirstRunConsent } from './lib/telemetry-consent';
import { createXrayUpgradeChecker } from './upgrade-checker';
import { CodedError, UsageError, EXIT_USAGE, EXIT_GENERIC } from './lib/error/types';
import { Logger } from './lib/logger';

/**
 * Reject argv whose first positional looks command-shaped but isn't a
 * registered subcommand or alias.
 *
 * With explore registered as the default (isDefault:true), commander
 * happily routes any unknown bareword into explore as the query, hiding
 * typos like `xray scna` (meant: `scan`) behind silent fallthrough. This
 * scanner intercepts those cases before parseAsync.
 *
 * Heuristic: the token is "command-shaped" if it's alphanumeric with
 * hyphens/underscores, no slashes/dots/parens/whitespace, and length
 * <30. That excludes legitimate explore queries (`"calls(main)"`,
 * `/tmp/foo`, `"foo bar baz"`) and lets them fall through to explore.
 */
function rejectUnknownSubcommand(program: any, argv: string[]): void {
  // argv shape from process.argv: [node, script, maybeSubcommand, ...]
  const positional = argv[2];
  if (!positional || positional.startsWith('-')) return;

  // Reject only tokens that LOOK like a command attempt. Heuristic:
  // alphanumeric + hyphens/underscores, no slashes/dots/parens/spaces.
  const COMMAND_SHAPE = /^[a-zA-Z][a-zA-Z0-9_-]{0,29}$/;
  if (!COMMAND_SHAPE.test(positional)) return;

  // Collect registered names + aliases (incl. dynamic strategy commands).
  const known = new Set<string>();
  for (const cmd of program.commands as any[]) {
    known.add(cmd.name());
    for (const alias of cmd.aliases?.() ?? []) known.add(alias);
  }
  if (known.has(positional)) return;

  // Disambiguate "typo" vs "bare query word":
  //   - contains '-' → definitely command-shaped (xray's commands use
  //     hyphens, queries don't). Reject.
  //   - close edit-distance to a registered name → likely typo. Reject.
  //   - otherwise → treat as a bare explore query (preserve UX).
  const suggestion = nearestCommand(positional, [...known]);
  const hasHyphen = positional.includes('-');
  if (!hasHyphen && !suggestion) return;

  const hint = suggestion ? ` (did you mean '${suggestion}'?)` : '';
  throw new UsageError(`unknown command '${positional}'${hint}`);
}

/** Levenshtein-1 nearest neighbour for did-you-mean. Cheap and good enough. */
function nearestCommand(input: string, candidates: string[]): string | null {
  let best: { name: string; d: number } | null = null;
  for (const c of candidates) {
    const d = editDistance(input, c);
    if (best === null || d < best.d) best = { name: c, d };
  }
  // Tolerance: short tokens (<=6 chars) → 2 edits (catches typos like
  // 'scna' vs 'scan' which Levenshtein scores at 2). Longer tokens →
  // length/4.
  const tol = input.length <= 6 ? 2 : Math.floor(input.length / 4);
  return best && best.d <= Math.max(1, tol) ? best.name : null;
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Pre-scan argv for -v/--verbose [level] and --quiet so diagnostics emitted
 * before commander parses honour them. Stops at `--`.
 */
function applyEarlyVerbosity(argv: string[]): void {
  const levels = ['silent', 'error', 'warn', 'info', 'debug'];
  const args = argv.slice(2);
  const end = args.indexOf('--');
  const scan = end === -1 ? args : args.slice(0, end);
  if (scan.includes('--quiet')) {
    Logger.setLevel('error');
    return;
  }
  for (let i = 0; i < scan.length; i++) {
    const a = scan[i];
    if (a === '-v' || a === '--verbose') {
      const next = scan[i + 1];
      Logger.setLevel(next && levels.includes(next.toLowerCase()) ? next : 'debug');
      return;
    }
    if (a.startsWith('--verbose=')) {
      Logger.setLevel(a.slice('--verbose='.length));
      return;
    }
  }
}

// Initialize and register all commands (async for alias registration)
export async function main() {
  // Apply verbosity first: config loading (consent, registration) emits
  // verbose-only diagnostics, and commander's preAction runs too late.
  applyEarlyVerbosity(process.argv);

  // Handle first-run telemetry consent
  const telemetryEnabled = await handleFirstRunConsent(process.argv);

  // Initialize telemetry based on consent
  const telemetry = initializeTelemetry({
    enabled: telemetryEnabled,
    projectRoot: process.cwd(),
  });

  // Track CLI invocation
  if (telemetry) {
    const commandName = process.argv[2] || 'unknown';
    const commandSpan = telemetry.startCommandSpan(commandName);

    // Shutdown telemetry on exit
    process.on('exit', () => {
      commandSpan.end();
      shutdownTelemetry();
    });

    // Handle errors
    process.on('uncaughtException', (error) => {
      telemetry.trackError('UncaughtException', error);
      commandSpan.end();
      shutdownTelemetry();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      telemetry.trackError('UnhandledRejection', error);
      commandSpan.end();
      shutdownTelemetry();
      process.exit(1);
    });
  }

  // Startup update notification (async, non-blocking)
  createXrayUpgradeChecker().notifyIfAvailable(process.stderr).catch(() => {});

  const program = await registerCommands();

  // Convert commander parse/usage errors → exit 2 instead of commander's default exit 1.
  // exitOverride must be applied to subcommands too — commander does not
  // propagate it implicitly.
  const applyExitOverride = (cmd: any) => {
    cmd.exitOverride();
    if (Array.isArray(cmd.commands)) {
      for (const sub of cmd.commands) applyExitOverride(sub);
    }
  };
  applyExitOverride(program);

  // Surface "Did you mean?" hints on unknown commands.
  program.showSuggestionAfterError(true);

  // Pre-parse guard for unknown subcommands.
  //
  // explore is registered with isDefault:true so bare `xray <query>` works
  // as a shortcut. But that means commander silently routes UNKNOWN command
  // names (e.g. `xray totallt-not-a-command`) into explore as the query,
  // hiding typos. Walk registered command names + aliases; if argv[2] is a
  // non-flag positional that LOOKS command-shaped (alphanumeric + hyphens,
  // no slashes/dots/parens/spaces) and isn't a registered name, throw a
  // UsageError before commander parses. Query strings (`"calls(main)"`),
  // file paths (`/tmp/foo`), and `--flag` values still fall through.
  rejectUnknownSubcommand(program, process.argv);

  try {
    await program.parseAsync(process.argv);
  } catch (err: any) {
    // Commander throws CommanderError for parse failures / unknown options / etc.
    // All those are usage errors → exit 2.
    if (err && err.code && typeof err.code === 'string' && err.code.startsWith('commander.')) {
      // commander.help / commander.version exit cleanly (0) — preserve that.
      if (err.exitCode === 0 || err.code === 'commander.help' || err.code === 'commander.version' || err.code === 'commander.helpDisplayed') {
        shutdownTelemetry();
        process.exit(0);
      }
      shutdownTelemetry();
      process.exit(EXIT_USAGE);
    }
    if (err instanceof CodedError) {
      Logger.error(err.message);
      shutdownTelemetry();
      process.exit(err.exitCode);
    }
    Logger.error(err && err.message ? err.message : String(err));
    shutdownTelemetry();
    process.exit(EXIT_GENERIC);
  }
}

/**
 * Top-level rejection handler for main(): CodedError -> its exit code,
 * anything else -> EXIT_GENERIC. Shared by bin/xray, bin/cli.js and the
 * direct-run path below.
 */
export function handleFatalError(error: unknown): never {
  if (error instanceof CodedError) {
    Logger.error(error.message);
    shutdownTelemetry();
    process.exit(error.exitCode);
  }
  Logger.error(error instanceof Error ? error.message : String(error));
  shutdownTelemetry();
  process.exit(EXIT_GENERIC);
}

// Run when executed directly (`node dist/index.js`); bin/xray calls main().
if (require.main === module) {
  main().catch(handleFatalError);
}

// Export for testing
export { registerCommands };