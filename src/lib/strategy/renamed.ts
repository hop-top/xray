/**
 * Built-in strategies that were renamed, by current name.
 * Empty now that `config` belongs to xray's own configuration introspection
 * (`xray config path` / `xray config paths`).
 */
export const RENAMED_STRATEGIES: Readonly<Record<string, string>> = {};

/** Whether `name` is the old name of a renamed built-in strategy. */
export function isRenamedStrategyName(name: string): boolean {
  return Object.values(RENAMED_STRATEGIES).includes(name);
}
