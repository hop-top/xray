import { AsyncEventEmitter } from './async-emitter';
import { XrayEvents } from './types';
import { XrayGraph, RankedNode } from '../../types/graph';
import { Logger } from '../logger';

/**
 * Typed public surface a plugin may rely on. Feature tracks (surprise,
 * clustering, question-generator, graphify) all need to read the graph,
 * stash per-run side data, and retrieve it later without narrowing casts.
 */
export interface XrayLike extends AsyncEventEmitter<XrayEvents> {
  getLastGraph(): { graph?: XrayGraph; rankedNodes?: RankedNode[] };
  stashSurprises(items: unknown[]): void;
  getSurprises(n?: number): unknown[];
}

export interface XrayPlugin {
  name: string;
  version?: string;

  /**
   * Called when plugin is registered
   * Use this to attach event listeners
   */
  apply(xray: XrayLike): void | Promise<void>;

  /**
   * Optional cleanup when plugin is removed
   */
  dispose?(): void | Promise<void>;
}

export class PluginManager {
  private plugins: Map<string, XrayPlugin> = new Map();

  async register(plugin: XrayPlugin, xray: XrayLike): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" already registered`);
    }

    // Call apply first - if it throws, plugin won't be registered
    await plugin.apply(xray);

    // Only add to map after successful apply
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Idempotent register: if a plugin with the same name is already present,
   * log a warning and return without throwing. Designed for preset bundles
   * (graphify-integration-init) that may re-apply sub-plugins across setups.
   */
  async applyIfAbsent(plugin: XrayPlugin, xray: XrayLike): Promise<void> {
    if (this.has(plugin.name)) {
      Logger.warn(`Plugin "${plugin.name}" already registered — skipping`);
      return;
    }
    return this.register(plugin, xray);
  }

  async unregister(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin "${pluginName}" not found`);
    }

    if (plugin.dispose) {
      await plugin.dispose();
    }

    this.plugins.delete(pluginName);
  }

  list(): XrayPlugin[] {
    return Array.from(this.plugins.values());
  }

  has(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }
}
