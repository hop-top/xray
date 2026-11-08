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

/** Root help groups (rendered in this order). */
export const HELP_GROUPS = [
  { id: 'analyze', title: 'ANALYZE' },
  { id: 'strategy', title: 'STRATEGY' },
  { id: 'management', title: 'MANAGEMENT' },
] as const;

export type HelpGroupId = (typeof HELP_GROUPS)[number]['id'];
