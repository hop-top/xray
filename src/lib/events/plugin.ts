import { AsyncEventEmitter } from './async-emitter';
import { XrayEvents } from './types';

// Define a generic interface that any Xray-like class can implement
interface XrayLike extends AsyncEventEmitter<XrayEvents> {}

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
