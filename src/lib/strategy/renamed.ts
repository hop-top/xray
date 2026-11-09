/**
 * Built-in strategies that were renamed, by current name. The old name
 * stays as a hidden command group forwarding to the same handlers (absent
 * from help, describe and the MCP tool list) and is reserved: a project
 * strategy cannot take it. Dropped when the CLI goes stable.
 */
export const RENAMED_STRATEGIES: Readonly<Record<string, string>> = { 'config-files': 'config' };

/** Whether `name` is the old name of a renamed built-in strategy. */
export function isRenamedStrategyName(name: string): boolean {
  return Object.values(RENAMED_STRATEGIES).includes(name);
}
