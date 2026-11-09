/**
 * `xray upgrade --check`: is a newer release out?
 *
 * Read-only. There is no install action: xray is installed by the package
 * manager, so bare `upgrade` points at `--check` and at the install
 * command. A newer release is a normal answer (exit 0, `updateAvailable`
 * true); only a failed lookup is an error (exit 6, transient).
 */
import type { Command } from 'commander';
import { Logger } from '../lib/logger';
import { TransientError, UsageError, withHelp } from '../lib/error/types';
import { addResultFormat, assertResultFormat, emitResult } from '../lib/result-format';
import { checkForUpgrade } from '../upgrade-checker';
import { declareEffect } from './side-effect';
import { terminalSafe } from '../lib/terminal-safe';

const INSTALL_CMD = 'npm i -g @hop-top/xray';

interface UpgradeOptions {
  check?: boolean;
}

export async function handleUpgradeAction(opts: UpgradeOptions, cmd: Command): Promise<void> {
  assertResultFormat(cmd);
  if (!opts.check) {
    throw withHelp(
      new UsageError(`upgrade only checks for a newer release: pass --check (to install, run: ${INSTALL_CMD})`),
      { suggestedFix: 'xray upgrade --check' },
    );
  }
  if (cmd.optsWithGlobals().offline) {
    throw new TransientError('could not check for updates: offline (--offline disables network access)');
  }
  const r = await checkForUpgrade();
  if (r.failed) {
    throw withHelp(new TransientError('could not check for updates: release lookup failed (network or GitHub unavailable)'), {
      suggestedFix: 'retry later',
    });
  }
  const updateAvailable = r.latest !== null;
  emitResult(
    cmd,
    { current: r.current, latest: r.latest, updateAvailable, url: r.url },
    () => {
      if (updateAvailable) {
        Logger.output(`update available: v${r.current} → v${terminalSafe(r.latest!)}`);
        Logger.output(terminalSafe(r.url!));
        Logger.output(`install: ${INSTALL_CMD}`);
      } else {
        Logger.output(`xray v${r.current} is up to date`);
      }
    },
  );
}

export function registerUpgradeCommand(program: Command): void {
  const cmd = program
    .command('upgrade')
    .description('Check whether a newer xray release is available (--check)')
    .option('--check', 'Look up the latest release and report; exit 0 either way, 6 if the lookup fails');
  addResultFormat(cmd);
  cmd.action(handleUpgradeAction);
  declareEffect(cmd, 'read', 'yes');
}
