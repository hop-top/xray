/**
 * Side-effect declarations kit's delegation gates read.
 *
 * Kit gates an undeclared leaf named remove/rm/delete/destroy/purge/drop
 * behind a confirmation that no terminal-less caller (scripts, CI, agents)
 * can answer. A leaf that changes only state xray itself manages (an alias
 * entry, a strategy file or package, an xray-managed language pack) says so
 * by declaring the `write-local` tier, which kit does not confirm.
 *
 * Kit then applies a root `--dry-run` to the leaf as a promise to preview.
 * These handlers do not, so the leaf opts out: `--dry-run` is a usage error
 * rather than a real run.
 */
import type { Command } from 'commander';

export function declareManagedWrite<C extends Command>(cmd: C, noDryRunReason: string): C {
  const target = cmd as unknown as { annotations?: Record<string, string> };
  target.annotations = {
    ...target.annotations,
    'kit/side-effect': 'write-local',
    'kit/dry-run': 'opted-out',
    'kit/dry-run-rationale': noDryRunReason,
  };
  return cmd;
}
