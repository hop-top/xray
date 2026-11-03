import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { styles, statusLine } from './tui';
import { Logger } from './logger';
import {
  findGlobalConfigPath,
  globalConfigDirs,
  isWritableConfigFile,
  loadConfig,
  loadGlobalConfig,
  saveConfig,
} from './config';
import type { XrayConfig } from '../types/xray-config';
import { TELEMETRY_POLICY, telemetryOffReason } from './telemetry-policy';

/**
 * Recorded telemetry decision, or undefined when none exists.
 * Precedence: project config / explicit `--config` file, then the global
 * (per-user) config. With an explicit `--config` the global config is still
 * consulted, so the per-user decision applies when that file has no
 * `telemetry` key.
 */
function resolveDecision(configPath?: string): boolean | undefined {
  const scoped = loadConfig(configPath);
  if (scoped && scoped.telemetry !== undefined) {
    return scoped.telemetry?.enabled ?? false;
  }
  const global = loadGlobalConfig();
  if (global && global.telemetry !== undefined) {
    return global.telemetry?.enabled ?? false;
  }
  return undefined;
}

/**
 * Check if telemetry consent has been given
 * Returns true if consent exists (either enabled or explicitly disabled)
 */
export function hasConsentDecision(configPath?: string): boolean {
  return resolveDecision(configPath) !== undefined;
}

/**
 * Check if user has explicitly disabled telemetry via flag
 */
export function isTelemetryDisabledByFlag(argv: string[]): boolean {
  return argv.includes(TELEMETRY_POLICY.flag);
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
  console.log(paint.muted('You are asked once. Change it anytime in your user config (xray paths shows where),'));
  console.log(paint.muted('or per project via "telemetry" in .xrayrc.json.'));
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
 * Save telemetry consent decision to the global (per-user) config, so it is
 * asked once per user rather than once per project. Never writes into the
 * cwd, project config, or the root `--config` file. Updates the existing
 * global config when it is plain JSON, else creates `config.json` in the
 * kit XDG config dir. A JS global config is left alone (not rewritable).
 */
export function saveConsentDecision(enabled: boolean): void {
  try {
    const existing = findGlobalConfigPath();
    if (existing !== null && !isWritableConfigFile(existing)) {
      Logger.debug(`Telemetry consent not saved: ${existing} is not a JSON config file`);
      return;
    }
    const target = existing ?? path.join(globalConfigDirs()[0], 'config.json');
    const config = (existing !== null ? loadGlobalConfig() : null) ?? ({} as XrayConfig);
    config.telemetry = { enabled };

    fs.mkdirSync(path.dirname(target), { recursive: true });
    saveConfig(config, target);

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
  // Forced off (flag, env, subprocess / pipe, CI, MCP, machine format):
  // wins over any saved decision; nothing is prompted or persisted, so a
  // later interactive run still uses (or asks for) the saved decision.
  const off = telemetryOffReason({ argv });
  if (off !== null) {
    Logger.debug(`Telemetry off for this run (${off})`);
    return false;
  }

  // Skip if consent decision already exists
  const decided = resolveDecision(configPath);
  if (decided !== undefined) {
    Logger.debug('Telemetry consent decision already exists');
    return decided;
  }

  // Cannot prompt without a terminal on stdin
  if (!process.stdin.isTTY) {
    Logger.debug('stdin is not a TTY, skipping telemetry prompt');
    return false;
  }

  // Prompt user for consent
  Logger.debug('Prompting user for telemetry consent');
  const consent = await promptForConsent();

  // Save decision (per user, global config)
  saveConsentDecision(consent);

  return consent;
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
