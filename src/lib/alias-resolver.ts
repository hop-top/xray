/**
 * Alias rules layered on `@hop-top/kit/alias`.
 *
 * kit owns the generic rules (name validation, cycle detection, command
 * bridging); xray adds the target shape `<strategy> <command>` and checks
 * targets against discovered strategies.
 *
 * tsconfig uses legacy `node` module resolution, which ignores the
 * package `exports` map, so types come from the dist path while the
 * runtime require goes through the exported subpath.
 */
import type { Command } from 'commander';
import type * as KitAlias from '@hop-top/kit/dist/alias';
import { Logger } from './logger';
import { jsonErrorsEnabled } from './error/report';
import { XrayConfig } from '../types/xray-config';
import { Strategy } from './strategy/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const kitAlias = require('@hop-top/kit/alias') as typeof KitAlias;

export type AliasMap = KitAlias.AliasMap;

const reservedSnapshots = new WeakMap<Command, readonly string[]>();

function liveCommandNames(root: Command): string[] {
  const names = new Set<string>(['help']);
  for (const cmd of root.commands) {
    names.add(cmd.name());
    for (const a of cmd.aliases()) names.add(a);
  }
  return [...names];
}

/**
 * Record the root's command names (incl. aliases, hidden commands, `help`)
 * as the reserved set. Call after every real command is registered and
 * before alias commands are bridged in, so aliases never reserve themselves.
 */
export function captureReservedNames(root: Command): readonly string[] {
  const names = liveCommandNames(root);
  reservedSnapshots.set(root, names);
  return names;
}

/** Names a configured alias must not take: derived from the registered root command tree. */
export function reservedAliasNames(root: Command): readonly string[] {
  return reservedSnapshots.get(root) ?? liveCommandNames(root);
}

/** Root of the command tree `cmd` belongs to. */
export function rootCommand(cmd: Command): Command {
  let c = cmd;
  while (c.parent) c = c.parent;
  return c;
}

/** Whether `target` has the `<strategy> <command>` shape. */
export function isAliasTarget(target: string): boolean {
  return target.includes(' ');
}

const problems: string[] = [];

/**
 * Alias problems found while registering, in order. They are config help
 * for a human: text mode warns on stderr, JSON mode keeps stderr to the
 * error envelope and surfaces them there (see `aliasProblemsFor`).
 */
export function aliasProblems(): readonly string[] {
  return problems;
}

/** What went wrong for one alias name, for an unknown-command envelope. */
export function aliasProblemsFor(name: string): string[] {
  return problems.filter((p) => {
    const cycle = /^Circular alias references detected: (.*)$/.exec(p);
    return cycle ? cycle[1].split(', ').includes(name) : p.includes(`"${name}"`);
  });
}

/** Record an alias problem; warn on stderr unless JSON errors are on. */
export function warnAlias(problem: string, shown: string = problem): void {
  problems.push(problem);
  if (!jsonErrorsEnabled()) Logger.warn(shown);
}

/** Split a target into its strategy and (possibly multi-word) command. */
export function splitAliasTarget(target: string): { strategyName: string; commandName: string } {
  const [strategyName, ...commandParts] = target.split(' ');
  return { strategyName, commandName: commandParts.join(' ') };
}

/**
 * Configured aliases with a valid name and target shape. Others are
 * skipped with a warning.
 */
export function usableAliases(config: XrayConfig, reserved: readonly string[]): AliasMap {
  const out: AliasMap = {};
  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    try {
      kitAlias.validateAliasName(alias, { builtins: reserved });
    } catch (err) {
      if (!(err instanceof kitAlias.AliasNameError)) throw err;
      warnAlias(err.kind === 'builtin'
        ? `Alias "${alias}" conflicts with built-in command, skipping`
        : `Invalid alias name "${alias}" (${err.message}), skipping`);
      continue;
    }

    if (!isAliasTarget(target)) {
      warnAlias(`Invalid alias target "${target}" for "${alias}" (must be "<strategy> <command>")`);
      continue;
    }

    out[alias] = target;
  }

  Logger.debug(`Loaded ${Object.keys(out).length} aliases`);
  return out;
}

/** One message per alias whose strategy or command is unknown. */
export function aliasTargetErrors(aliases: AliasMap, strategies: Strategy[]): string[] {
  const errors: string[] = [];
  const strategyMap = new Map(strategies.map(s => [s.name, s]));

  for (const [alias, target] of Object.entries(aliases)) {
    const [strategyName, commandName] = target.split(' ', 2);

    const strategy = strategyMap.get(strategyName);
    if (!strategy) {
      errors.push(`Alias "${alias}" targets unknown strategy "${strategyName}"`);
      continue;
    }

    if (!strategy.commands || !strategy.commands[commandName]) {
      errors.push(`Alias "${alias}" targets unknown command "${commandName}" in strategy "${strategyName}"`);
    }
  }

  return errors;
}

/** Names of aliases on a cycle, each once, in kit's cycle order. */
export function circularAliases(aliases: AliasMap): string[] {
  const names = new Set<string>();
  for (const cycle of kitAlias.detectCycles(aliases)) {
    for (const name of cycle) names.add(name);
  }
  return [...names];
}
