import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { styles, statusLine } from './tui';
import { Logger } from './logger';
import { isWritableConfigFile, loadConfig, saveConfig } from './config';
import type { XrayConfig } from '../types/xray-config';

/**
 * Check if telemetry consent has been given
 * Returns true if consent exists (either enabled or explicitly disabled)
 */
export function hasConsentDecision(configPath?: string): boolean {
  const config = loadConfig(configPath);

  // If config exists and has telemetry setting, consent has been decided
  if (config && config.telemetry !== undefined) {
    return true;
  }

  return false;
}

/**
 * Check if user has explicitly disabled telemetry via flag
 */
export function isTelemetryDisabledByFlag(argv: string[]): boolean {
  return argv.includes('--no-telemetry');
}

/**
 * Prompt user for telemetry consent
 * Returns true if user consents, false otherwise
 */
export async function promptForConsent(): Promise<boolean> {
  const paint = styles(process.stdout);

  // Clear any existing output
  console.log('');

  // Display telemetry information
  console.log(paint.bold(paint.accent('Welcome to Xray!')));
  console.log('');
  console.log(paint.muted('Xray can collect anonymous usage data to help improve the tool.'));
  console.log('');
  console.log(paint.bold('What data is collected:'));
  console.log('  • Command usage (which commands you run)');
  console.log('  • Performance metrics (execution time, memory usage)');
  console.log('  • Error types (what errors occur)');
  console.log('  • System info (OS, architecture, Node version)');
  console.log('');
  console.log(paint.bold('What is NOT collected:'));
  console.log('  • Your source code or file contents');
  console.log('  • File paths (except in error context)');
  console.log('  • Personal information');
  console.log('  • Network activity (data stays local)');
  console.log('');
  console.log(paint.muted('All data is stored locally in .xray/telemetry.json'));
  console.log(paint.muted('You can change this setting anytime in .xrayrc.json'));
  console.log('');

  const answer = await askQuestion(
    paint.bold('Enable telemetry?') + ' [Y/n]: '
  );

  const consent = answer.toLowerCase() !== 'n' && answer.toLowerCase() !== 'no';

  console.log('');
  if (consent) {
    console.log(statusLine('Telemetry enabled. Thank you!', 'success'));
  } else {
    console.log(paint.warn('✓ Telemetry disabled.'));
  }
  console.log('');

  return consent;
}

/**
 * Save telemetry consent decision to config: the root `--config` file
 * when given (skipped unless it is JSON), else `./.xrayrc.json`.
 */
export function saveConsentDecision(enabled: boolean, configPath?: string): void {
  try {
    if (configPath !== undefined && !isWritableConfigFile(configPath)) {
      Logger.debug(`Telemetry consent not saved: ${configPath} is not a JSON config file`);
      return;
    }
    let config = loadConfig(configPath);

    if (!config) {
      // Create minimal config if none exists. Do not seed `paths`: a seeded
      // path is indistinguishable from a user-provided one and disables
      // strategy auto-detection / auto-configuration.
      config = {} as XrayConfig;
    }

    // Set telemetry preference
    config.telemetry = {
      enabled
    };

    // Save config
    if (configPath === undefined) saveConfig(config);
    else saveConfig(config, configPath);

    Logger.debug(`Telemetry consent saved: ${enabled}`);
  } catch (error) {
    Logger.debug('Failed to save telemetry consent', error);
    // Don't throw - consent failure shouldn't block CLI usage
  }
}

/**
 * Handle first-run telemetry consent flow
 * Returns true if telemetry should be enabled
 */
export async function handleFirstRunConsent(argv: string[], configPath?: string): Promise<boolean> {
  // Skip if --no-telemetry flag is present
  if (isTelemetryDisabledByFlag(argv)) {
    Logger.debug('Telemetry disabled by --no-telemetry flag');
    return false;
  }

  // Skip if consent decision already exists
  if (hasConsentDecision(configPath)) {
    Logger.debug('Telemetry consent decision already exists');
    const config = loadConfig(configPath);
    return config?.telemetry?.enabled ?? false;
  }

  // Skip prompts in non-interactive mode (CI/CD, piped output, etc.)
  if (!isInteractive()) {
    Logger.debug('Non-interactive mode detected, skipping telemetry prompt');
    // Default to disabled in non-interactive mode
    saveConsentDecision(false, configPath);
    return false;
  }

  // Prompt user for consent
  Logger.debug('Prompting user for telemetry consent');
  const consent = await promptForConsent();

  // Save decision
  saveConsentDecision(consent, configPath);

  return consent;
}

/**
 * Check if we're in an interactive terminal
 */
function isInteractive(): boolean {
  // Check if stdin and stdout are TTYs
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  // Check for common CI environment variables
  const ciEnvVars = [
    'CI',
    'CONTINUOUS_INTEGRATION',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'TRAVIS',
    'JENKINS_URL',
    'BUILDKITE',
    'TEAMCITY_VERSION'
  ];

  for (const envVar of ciEnvVars) {
    if (process.env[envVar]) {
      return false;
    }
  }

  return true;
}

/**
 * Ask user a question and return their answer
 */
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
