#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { registerCommands } from './commands';
import { program as rootProgram } from './commands/root-program';
import { initializeTelemetry, shutdownTelemetry } from './lib/telemetry';
import { loadConfig } from './lib/config';
import { handleFirstRunConsent } from './lib/telemetry-consent';
import { createXrayUpgradeChecker } from './upgrade-checker';
import { CodedError, UsageError, withHelp, EXIT_USAGE, EXIT_GENERIC } from './lib/error/types';
import { Logger } from './lib/logger';
import { aliasProblemsFor } from './lib/alias-resolver';
import { nearestMatch as nearestCommand } from './lib/did-you-mean';
import {
  jsonRequested, setJsonErrors, jsonErrorsEnabled, toCliError, usageEnvelope, valueOptionNames, writeEnvelope,
} from './lib/error/report';
import { StrategyLoader, reportSkippedProjectCode } from './lib/strategy/loader';
import { defaultRouteFromArgv, resolveLogLevel, rootConfigFromArgv } from './commands/root-options';
import { isCompletionRequest } from './commands/completion';
import { ROUTED_PATH_KEY, ROUTED_SELF_KEY } from './commands/explore';
import { applyMcpChdir, parseMcpRequest } from './commands/mcp';

/**
 * Reject input that would otherwise fall through to the default command.
 *
 * explore is registered with isDefault:true, so commander routes anything
 * that is not a registered command (or follows an option the root does not
 * own, e.g. `--format` before the subcommand) into explore, which lists
 * files and ignores it. A bare `xray` keeps that default; otherwise the
 * first operand must be a registered command or alias (strategy commands
 * included), or an existing path (which the default command scans).
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
    if (!stray) return;
    if (word === 'explore') {
      // `xray --format json explore`: the default route passes the word
      // `explore` through as an operand; tell explore to ignore it.
      program.commands.find((c: any) => c.name() === 'explore')?.setOptionValue(ROUTED_SELF_KEY, true);
      return;
    }
    throw new UsageError(
      `option '${stray}' belongs after the command, not before it (xray ${word} ... ${stray})`
    );
  }

  if (fs.existsSync(path.resolve(base, word))) {
    // `xray <path>`: the default command scans that path.
    program.commands.find((c: any) => c.name() === 'explore')?.setOptionValue(ROUTED_PATH_KEY, word);
    return;
  }

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
  // An alias that failed validation was never registered: say why.
  const why = aliasProblemsFor(word);
  throw withHelp(new UsageError(`unknown command '${word}'${hint}`), {
    suggestedFix: why.length > 0 ? why.join('; ') : undefined,
  });
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
  // Fatal errors render as one JSON envelope on stderr when JSON was asked
  // for. The command tree is not built yet, so only root options are known
  // here; refined below once every command is registered.
  setJsonErrors(jsonRequested(argv, valueOptionNames(rootProgram)));

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
  // `upgrade` does its own lookup; the notice would repeat it.
  if (!mcpRequest && !argv.includes('--offline') && defaultRouteFromArgv(rootProgram, argv).word !== 'upgrade') {
    pendingUpgradeCheck = createXrayUpgradeChecker().notifyIfAvailable(process.stderr).catch(() => {});
  }

  const program = await registerCommands({}, rootConfig);
  setJsonErrors(jsonRequested(argv, valueOptionNames(program)));
  // Kit's delegation gates (confirmation, policy, --dry-run refusal) render
  // their refusal in the root's `format`; xray's `--format` lives on the
  // subcommands, so hand them the one the caller asked for.
  if (jsonErrorsEnabled()) program.setOptionValue('format', 'json');

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
    // In JSON mode the usage error is rendered once, as an envelope, by the
    // catch below: commander must not print its own line or the help.
    if (jsonErrorsEnabled()) cmd.configureOutput({ outputError: () => {} }).showHelpAfterError(false);
    if (Array.isArray(cmd.commands)) {
      for (const sub of cmd.commands) applyParseSettings(sub);
    }
  };
  applyParseSettings(program);

  // Operands reach explore's action (it rejects them with a usage error
  // naming --match/--search, except a path handed over by default
  // routing). Set after applyParseSettings, since copyInheritedSettings
  // overwrites the flag from the parent. Words that reach it by default
  // routing are vetted by rejectUnknownInput below.
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
      if (jsonErrorsEnabled()) writeEnvelope(usageEnvelope(String(err.message ?? '')));
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
    handleFatalError(err);
  }
}

/**
 * Top-level rejection handler for main(): CodedError -> its exit code,
 * anything else -> EXIT_GENERIC. Shared by bin/xray, bin/cli.js and the
 * direct-run path below.
 */
export function handleFatalError(error: unknown): never {
  const code = error instanceof CodedError ? error.exitCode : EXIT_GENERIC;
  if (jsonErrorsEnabled()) {
    writeEnvelope(toCliError(error));
  } else if (error instanceof CodedError) {
    Logger.error(error.message);
  } else {
    Logger.error(error && (error as Error).message ? (error as Error).message : String(error));
  }
  shutdownTelemetry();
  process.exit(code);
}

// Run when executed directly (`node dist/index.js`); bin/xray calls main().
if (require.main === module) {
  main().then(exitWhenSettled).catch(handleFatalError);
}

// Export for testing
export { registerCommands };