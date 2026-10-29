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
import type * as KitAlias from '@hop-top/kit/dist/alias';
import { Logger } from './logger';
import { XrayConfig } from '../types/xray-config';
import { Strategy } from './strategy/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const kitAlias = require('@hop-top/kit/alias') as typeof KitAlias;

export type AliasMap = KitAlias.AliasMap;

/** Names a configured alias must not take. */
export const RESERVED_ALIAS_NAMES: readonly string[] = [
  'map', 'scan', 'graph', 'find', 'detect', 'strategies', 'strategy',
  'save', 'load', 'snapshot', 'plugin', 'alias', 'lang', 'config',
  'clear-cache', 'completion', 'help', 'version',
];

/** Whether `target` has the `<strategy> <command>` shape. */
export function isAliasTarget(target: string): boolean {
  return target.includes(' ');
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
export function usableAliases(config: XrayConfig): AliasMap {
  const out: AliasMap = {};
  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    try {
      kitAlias.validateAliasName(alias, { builtins: RESERVED_ALIAS_NAMES });
    } catch (err) {
      if (!(err instanceof kitAlias.AliasNameError)) throw err;
      Logger.warn(err.kind === 'builtin'
        ? `Alias "${alias}" conflicts with built-in command, skipping`
        : `Invalid alias name "${alias}" (${err.message}), skipping`);
      continue;
    }

    if (!isAliasTarget(target)) {
      Logger.warn(`Invalid alias target "${target}" for "${alias}" (must be "<strategy> <command>")`);
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
