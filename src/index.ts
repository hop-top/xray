#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { registerCommands } from './commands';
import { program as rootProgram } from './commands/root-program';
import { initializeTelemetry, shutdownTelemetry } from './lib/telemetry';
import { loadConfig } from './lib/config';
import { handleFirstRunConsent } from './lib/telemetry-consent';
import { createXrayUpgradeChecker } from './upgrade-checker';
import { CodedError, UsageError, EXIT_USAGE, EXIT_GENERIC } from './lib/error/types';
import { Logger } from './lib/logger';
import { StrategyLoader, reportSkippedProjectCode } from './lib/strategy/loader';
import { defaultRouteFromArgv, resolveLogLevel, rootConfigFromArgv } from './commands/root-options';
import { isCompletionRequest } from './commands/completion';
import { applyMcpChdir, parseMcpRequest } from './commands/mcp';

/**
 * Reject input that would otherwise fall through to the default command.
 *
 * explore is registered with isDefault:true, so commander routes anything
 * that is not a registered command (or follows an option the root does not
 * own, e.g. `--format` before the subcommand) into explore, which lists
 * files and ignores it. A bare `xray` keeps that default; otherwise the
 * first operand must be a registered command or alias (strategy commands
 * included), or an existing path (a query for the default command).
 * Anything else is a usage error, exit 2.
 */
function rejectUnknownInput(program: any, argv: string[]): void {
  const { word, rest, stray, base } = defaultRouteFromArgv(program, argv);
  if (!word) return;

  // Registered names + aliases (incl. dynamic strategy commands) and
  // commander's implicit `help`.
  const known = new Set<string>(['help']);
  for (const cmd of program.commands as any[]) {
    known.add(cmd.name());
    for (const alias of cmd.aliases?.() ?? []) known.add(alias);
  }

  if (known.has(word)) {
    // `explore` after a leading option is the default command itself.
    if (!stray || word === 'explore') return;
    throw new UsageError(
      `option '${stray}' belongs after the command, not before it (xray ${word} ... ${stray})`
    );
  }

  if (fs.existsSync(path.resolve(base, word))) return;

  // An unknown word may name a command of a strategy that was not loaded
  // (project code is opt-in): say so. A bare word is only worth the notice
  // when it matches a skipped strategy's file or package name, or when
  // more words follow (`xray name command`); the strategy's own name lives
  // in code that is not run, so the file and package names are all there is.
  if (
    /^[a-zA-Z][a-zA-Z0-9_-]{0,29}$/.test(word) &&
    (rest.length > 0 || new StrategyLoader().skippedProjectCodeMayBeNamed(word))
  ) {
    reportSkippedProjectCode('warn');
  }

  const suggestion = nearestCommand(word, [...known]);
  const hint = suggestion ? ` (did you mean '${suggestion}'?)` : '';
  throw new UsageError(`unknown command '${word}'${hint}`);
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
 * Pre-scan argv for --quiet, --log-level and -V/--verbose so diagnostics
 * emitted before commander parses honour them. Same precedence as the
 * root preAction hook. Stops at `--`. Invalid levels are left for the
 * parsed hook to reject.
 */
function applyEarlyVerbosity(argv: string[]): void {
  const args = argv.slice(2);
  const end = args.indexOf('--');
  const scan = end === -1 ? args : args.slice(0, end);
  const opts: Record<string, unknown> = { verbose: 0 };
  for (let i = 0; i < scan.length; i++) {
    const a = scan[i];
    if (a === '--quiet') opts.quiet = true;
    else if (a === '--verbose') opts.verbose = (opts.verbose as number) + 1;
    else if (/^-V+$/.test(a)) opts.verbose = (opts.verbose as number) + a.length - 1;
    else if (a.startsWith('--log-level=')) opts.logLevel = a.slice('--log-level='.length);
    else if (a === '--log-level' && i + 1 < scan.length) opts.logLevel = scan[++i];
  }
  try {
    const level = resolveLogLevel(opts);
    if (level !== undefined) Logger.setLevel(level);
  } catch {
    // reported by the root preAction hook after parse
  }
}

/** In-flight startup upgrade check, if this run started one. */
let pendingUpgradeCheck: Promise<void> | null = null;

/** How long a finished command waits for the upgrade notice before leaving it. */
export const UPGRADE_CHECK_GRACE_MS = 500;

const drained = (stream: NodeJS.WriteStream): Promise<void> =>
  new Promise((resolve) => {
    try {
      stream.write('', () => resolve());
    } catch {
      resolve();
    }
  });

/**
 * Call once `main()` has resolved. The upgrade check is best-effort; its
 * socket must not keep a finished command alive (a dead network would hold
 * it for the request timeout). Give it a short grace so a prompt answer
 * still prints its notice, then, only if it is still pending, flush stdout
 * and stderr and exit with the code already set. When the check has
 * settled, or none ran, the process ends on its own.
 */
export async function exitWhenSettled(): Promise<void> {
  const check = pendingUpgradeCheck;
  if (!check) return;
  let settled = false;
  const done = check.then(() => { settled = true; });
  const grace = new Promise<void>((resolve) => setTimeout(resolve, UPGRADE_CHECK_GRACE_MS).unref());
  await Promise.race([done, grace]);
  if (settled) return;
  await Promise.all([drained(process.stdout), drained(process.stderr)]);
  process.exit(process.exitCode ?? 0);
}

// Initialize and register all commands (async for alias registration)
export async function main() {
  // Apply verbosity first: config loading (consent, registration) emits
  // verbose-only diagnostics, and commander's preAction runs too late.
  let argv = process.argv;
  applyEarlyVerbosity(argv);

  // Shell completion (`xray __complete ...`, run on every tab): answered
  // from the command tree only. No consent write, telemetry or network,
  // and no code from the working directory: tab in an untrusted checkout
  // must not run its strategies.
  if (isCompletionRequest(argv)) {
    const program = await registerCommands({ projectCode: false });
    await program.parseAsync(argv);
    return;
  }

  // `xray mcp` owns stdin/stdout for the protocol: no consent prompt
  // (or consent write), no telemetry, no upgrade check. -C applies now
  // so strategy discovery sees the served project.
  const mcpRequest = parseMcpRequest(argv);
  if (mcpRequest) argv = applyMcpChdir(argv, mcpRequest);

  // Root --config replaces config discovery for every load in the run,
  // including the ones below that happen before commander parses.
  const rootConfig = rootConfigFromArgv(rootProgram, argv);

  // Handle first-run telemetry consent
  const telemetryEnabled = mcpRequest ? false : await handleFirstRunConsent(argv, rootConfig);

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

  // Startup update notification (async, non-blocking); --offline means
  // no network access.
  if (!mcpRequest && !argv.includes('--offline')) {
    pendingUpgradeCheck = createXrayUpgradeChecker().notifyIfAvailable(process.stderr).catch(() => {});
  }

  const program = await registerCommands({}, rootConfig);

  // Convert commander parse/usage errors → exit 2 instead of commander's default exit 1.
  // exitOverride must be applied to subcommands too — commander does not
  // propagate it implicitly.
  // Surplus positionals are a usage error on every command except the two
  // opted in after this walk.
  // Subtrees built standalone and attached via addCommand() do not inherit
  // the root's help/output configuration; copy it down so every level
  // renders with the kit help layout.
  const applyParseSettings = (cmd: any) => {
    if (cmd.parent) cmd.copyInheritedSettings(cmd.parent);
    cmd.exitOverride();
    if (Array.isArray(cmd.commands)) {
      for (const sub of cmd.commands) applyParseSettings(sub);
    }
  };
  applyParseSettings(program);

  // explore takes extra operands (`xray explore <framework>:<cmd>`). Set
  // after applyParseSettings, since copyInheritedSettings overwrites the
  // flag from the parent. Words that reach it by default routing are
  // vetted by rejectUnknownInput below.
  program.commands.find((c) => c.name() === 'explore')?.allowExcessArguments();

  // `completion <shell>`: kit's command takes the shell as an operand that
  // its action reads to report an unsupported one.
  program.commands.find((c) => c.name() === 'completion')?.allowExcessArguments();

  // Surface "Did you mean?" hints on unknown commands.
  program.showSuggestionAfterError(true);

  // Pre-parse guard: an unknown word or an option the root does not own
  // must not fall through to the default command (see rejectUnknownInput).
  rejectUnknownInput(program, argv);

  try {
    await program.parseAsync(argv);
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
    // Kit's delegation gates (confirmation, policy, dry-run preview) render
    // their own refusal or preview and exit through commander with the
    // contract code (e.g. 5 unauthorized, 0 preview). Keep that code and
    // do not print the message a second time.
    if (err && typeof err.code === 'string' && err.code.startsWith('kit.') && Number.isInteger(err.exitCode)) {
      shutdownTelemetry();
      process.exit(err.exitCode);
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
  main().then(exitWhenSettled).catch(handleFatalError);
}

// Export for testing
export { registerCommands };