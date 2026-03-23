#!/usr/bin/env node
import { registerCommands } from './commands';
import { initializeTelemetry, shutdownTelemetry } from './lib/telemetry';
import { loadConfig } from './lib/config';
import { handleFirstRunConsent } from './lib/telemetry-consent';
import { createUpgrader } from '@hop/upgrade-ts';

const _up = createUpgrader({ binary: 'xray', githubRepo: 'ideacrafterslabs/oss-xray-codes' });
const XRAY_VERSION = '0.0.1-alpha.1';

// Initialize and register all commands (async for alias registration)
async function main() {
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

  // Startup update notification (async, non-blocking; skipped for upgrade cmd)
  if (process.argv[2] !== 'upgrade') {
    _up.notifyIfAvailable(XRAY_VERSION).catch(() => {});
  }

  const program = await registerCommands();

  // Handle CLI execution
  if (require.main === module) {
    program.parse();
  } else {
    // For when module is required (like from bin/xray)
    // Parse the arguments that were passed to the process
    program.parse(process.argv);
  }
}

// Run the CLI
main().catch(error => {
  console.error('Fatal error:', error);
  shutdownTelemetry();
  process.exit(1);
});

// Export for testing
export { registerCommands };