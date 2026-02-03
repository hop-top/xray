import type { QueryAdapter } from './types';

/**
 * QueryAdapterRegistry manages available query adapters in an instance-based,
 * thread-safe manner.
 *
 * Instance-based design (not static) ensures:
 * - No race conditions in concurrent environments
 * - No test pollution (each test gets clean registry)
 * - Supports adapter cleanup via unregister()
 * - Deterministic lookup order (Map preserves insertion order)
 *
 * Security: Registry prevents duplicate syntax registration to avoid conflicts.
 */
export class QueryAdapterRegistry {
  private adapters: Map<string, QueryAdapter> = new Map();

  /**
   * Register a query adapter.
   * Throws if an adapter with the same syntax is already registered.
   */
  register(adapter: QueryAdapter): void {
    if (this.adapters.has(adapter.syntax)) {
      throw new Error(`Adapter '${adapter.syntax}' already registered`);
    }
    this.adapters.set(adapter.syntax, adapter);
  }

  /**
   * Unregister a query adapter by syntax.
   * Safe to call even if adapter doesn't exist.
   */
  unregister(syntax: string): void {
    this.adapters.delete(syntax);
  }

  /**
   * Find an adapter that can parse the given query.
   * Returns null if no adapter matches.
   * Returns first matching adapter if multiple match (insertion order).
   */
  find(query: string): QueryAdapter | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.canParse(query)) {
        return adapter;
      }
    }
    return null;
  }

  /**
   * List all registered adapters.
   * Returns adapters in registration order.
   */
  list(): QueryAdapter[] {
    return Array.from(this.adapters.values());
  }
}
