#!/usr/bin/env node
import { registerCommands } from './commands';
import { initializeTelemetry, shutdownTelemetry } from './lib/telemetry';
import { loadConfig } from './lib/config';
import { handleFirstRunConsent } from './lib/telemetry-consent';
import { createXrayUpgradeChecker } from './upgrade-checker';
import { CodedError, EXIT_USAGE, EXIT_GENERIC } from './lib/error/types';
import { Logger } from './lib/logger';

// Initialize and register all commands (async for alias registration)
export async function main() {
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

// Run when executed directly (`node dist/index.js`); bin/xray calls main().
if (require.main === module) {
  main().catch(error => {
    if (error instanceof CodedError) {
      Logger.error(error.message);
      shutdownTelemetry();
      process.exit(error.exitCode);
    }
    console.error('Fatal error:', error);
    shutdownTelemetry();
    process.exit(EXIT_GENERIC);
  });
}

// Export for testing
export { registerCommands };