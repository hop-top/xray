// Re-export from shared @hop/upgrade-ts package.
// xray-specific config is applied at call-site via createUpgrader().
export {
  createUpgrader,
  checkForUpdate,
  isNewer,
  isSnoozed,
  snooze,
  notifyIfAvailable,
  runUpgradeCLI,
  replaceBinary,
  generateUpgradePreamble,
} from '@hop/upgrade-ts';
export type { UpdateResult, SnoozeLevel, Upgrader, UpgradeConfig } from '@hop/upgrade-ts';
