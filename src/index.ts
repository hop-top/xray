#!/usr/bin/env node
import { registerCommands } from './commands';
import { initializeTelemetry, shutdownTelemetry } from './lib/telemetry';
import { loadConfig } from './lib/config';
import { handleFirstRunConsent } from './lib/telemetry-consent';
import { createXrayUpgradeChecker } from './upgrade-checker';

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

  program.parse(process.argv);
}

// Run when executed directly (`node dist/index.js`); bin/xray calls main().
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    shutdownTelemetry();
    process.exit(1);
  });
}

// Export for testing
export { registerCommands };