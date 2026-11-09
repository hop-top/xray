/**
 * Side-effect declarations kit's delegation gates read.
 *
 * Every runnable leaf declares what it does to the world with kit's
 * `kit/side-effect` tier and `kit/idempotent` class. Kit acts on them:
 *
 * - a destructive tier (`destructive-local`, ...) is refused unless the
 *   caller confirms (`--confirm=yes`, or an answer at a terminal prompt);
 * - a write or destructive tier honors a root `--dry-run`: kit skips the
 *   confirmation and the handler prints a plan instead of acting;
 * - `read` ignores `--dry-run` and simply runs.
 *
 * Tiers xray uses: `read` (also for commands whose only write is a
 * regenerable cache in xray's own cache dir); `write-local` (files in the
 * project, the config, or xray's data dir); `destructive-local` (deletes
 * user-visible local state); `interactive` (a long-lived session).
 */
import type { Command } from 'commander';
import { isDryRun, renderPlan, type Effect, type Plan } from './kit-cli';

export type Tier = 'read' | 'write-local' | 'destructive-local' | 'interactive';
export type Idempotency = 'yes' | 'no' | 'conditional';

export const SIDE_EFFECT_KEY = 'kit/side-effect';
export const IDEMPOTENT_KEY = 'kit/idempotent';

type Annotated = { annotations?: Record<string, string> };

/** Declare `cmd`'s side-effect tier and idempotency; returns `cmd`. */
export function declareEffect<C extends Command>(cmd: C, tier: Tier, idempotent: Idempotency): C {
  const target = cmd as unknown as Annotated;
  target.annotations = { ...target.annotations, [SIDE_EFFECT_KEY]: tier, [IDEMPOTENT_KEY]: idempotent };
  return cmd;
}

export const OMIT_DESCRIBE_KEY = 'xray/omit-describe';

/** Keep `cmd` (a hidden alias of another command) out of `describe`. */
export function markOmittedFromDescribe<C extends Command>(cmd: C): C {
  const target = cmd as unknown as Annotated;
  target.annotations = { ...target.annotations, [OMIT_DESCRIBE_KEY]: 'yes' };
  return cmd;
}

export function omittedFromDescribe(cmd: Command): boolean {
  return (cmd as unknown as Annotated).annotations?.[OMIT_DESCRIBE_KEY] === 'yes';
}

export const EXIT_CODES_KEY = 'xray/exit-codes';

/**
 * Declare exit codes beyond 0/1/2 that `cmd` can produce, for commands
 * registered in bulk (strategy commands) where `describe` has no static
 * entry. Returns `cmd`.
 */
export function declareExitCodes<C extends Command>(cmd: C, codes: readonly number[]): C {
  const target = cmd as unknown as Annotated;
  target.annotations = { ...target.annotations, [EXIT_CODES_KEY]: codes.join(',') };
  return cmd;
}

/** Codes `cmd` declared with {@link declareExitCodes}. */
export function declaredExitCodes(cmd: Command): number[] {
  const raw = (cmd as unknown as Annotated).annotations?.[EXIT_CODES_KEY];
  return raw ? raw.split(',').map(Number).filter(Number.isInteger) : [];
}

/** What `cmd` declares; a field is undefined when not declared. */
export function declaredEffect(cmd: Command): { tier?: string; idempotent?: string } {
  const ann = (cmd as unknown as Annotated).annotations ?? {};
  return { tier: ann[SIDE_EFFECT_KEY], idempotent: ann[IDEMPOTENT_KEY] };
}

/** True when the run is a dry run: the handler must plan, not act. */
export function previewing(cmd: Command, ownFlag?: boolean): boolean {
  return ownFlag === true || isDryRun(cmd);
}

/**
 * Print what a real run would change; `format` json|yaml, else a table.
 * Unless given, the format is the command's own `--format`.
 */
export function emitPlan(
  cmd: Command,
  effects: Effect[],
  extra: Omit<Plan, 'effects'> = {},
  format: string = String(cmd.opts().format ?? 'text').toLowerCase()
): void {
  const path: string[] = [];
  for (let c: Command | null = cmd; c; c = c.parent) path.unshift(c.name());
  renderPlan(process.stdout, format, { ...extra, effects }, path.join(' '));
}
