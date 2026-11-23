/**
 * Typed bridge to `@hop-top/kit/cli`.
 *
 * tsconfig uses legacy `node` module resolution, which ignores the
 * package `exports` map, so types come from the dist path while the
 * runtime require goes through the exported `./cli` subpath.
 */
import type * as KitCli from '@hop-top/kit/dist/cli';

export type { Theme, CLIConfig, CLIResult } from '@hop-top/kit/dist/cli';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const kit = require('@hop-top/kit/cli') as typeof KitCli;

export const createCLI = kit.createCLI;
export const setCommandGroup = kit.setCommandGroup;
export const getCommandGroup = kit.getCommandGroup;
export const verboseCount = kit.verboseCount;
export const isDryRun = kit.isDryRun;
export const resolveDryRunPolicy = kit.resolveDryRunPolicy;
export const renderPlan = kit.renderPlan;
export const hintsEnabled = kit.hintsEnabled;

export type { Plan, Effect } from '@hop-top/kit/dist/cli';

/**
 * Root help groups (rendered in this order).
 * STRATEGY and MANAGEMENT are hidden from default `-h` and revealed
 * via `--help-all` or `--help-<group>`.
 */
export const HELP_GROUPS: ReadonlyArray<{ id: HelpGroupId; title: string; hidden?: boolean }> = [
  { id: 'analyze', title: 'ANALYZE' },
  { id: 'compose', title: 'COMPOSE' },
  { id: 'interact', title: 'INTERACT' },
  { id: 'lifecycle', title: 'LIFECYCLE' },
  { id: 'strategy', title: 'STRATEGY', hidden: true },
  { id: 'management', title: 'MANAGEMENT', hidden: true },
];

export type HelpGroupId = 'analyze' | 'compose' | 'interact' | 'lifecycle' | 'strategy' | 'management';
