import { Logger } from './logger';
import { XrayConfig } from '../types/xray-config';
import { StrategyLoader } from './strategy/loader';

export interface AliasResolution {
  isAlias: boolean;
  target?: string;
  strategyName?: string;
  commandName?: string;
}

export class AliasResolver {
  private aliases: Map<string, string> = new Map();
  private builtInCommands: Set<string> = new Set([
    'map', 'scan', 'graph', 'find', 'detect', 'strategies', 'strategy',
    'save', 'load', 'snapshot', 'plugin', 'alias', 'lang', 'config',
    'clear-cache', 'completion', 'help', 'version'
  ]);

  constructor(private config: XrayConfig) {
    this.loadAliases();
  }

  private loadAliases(): void {
    if (!this.config.aliases) return;

    for (const [alias, target] of Object.entries(this.config.aliases)) {
      // Validate alias doesn't conflict with built-in
      if (this.builtInCommands.has(alias)) {
        Logger.warn(`Alias "${alias}" conflicts with built-in command, skipping`);
        continue;
      }

      // Validate target format
      if (!target.includes(' ')) {
        Logger.warn(`Invalid alias target "${target}" for "${alias}" (must be "<strategy> <command>")`);
        continue;
      }

      this.aliases.set(alias, target);
    }

    Logger.debug(`Loaded ${this.aliases.size} aliases`);
  }

  /**
   * Resolve a command name to its target
   */
  resolve(commandName: string): AliasResolution {
    const target = this.aliases.get(commandName);

    if (!target) {
      return { isAlias: false };
    }

    const [strategyName, ...commandParts] = target.split(' ');
    const resolvedCommandName = commandParts.join(' ');

    return {
      isAlias: true,
      target,
      strategyName,
      commandName: resolvedCommandName
    };
  }

  /**
   * Check if a command name is an alias
   */
  isAlias(commandName: string): boolean {
    return this.aliases.has(commandName);
  }

  /**
   * Get all configured aliases
   */
  getAll(): Map<string, string> {
    return new Map(this.aliases);
  }

  /**
   * Validate all aliases against loaded strategies
   */
  async validateAliases(loader: StrategyLoader): Promise<string[]> {
    const errors: string[] = [];
    const strategies = await loader.discoverStrategies();
    const strategyMap = new Map(strategies.map(s => [s.name, s]));

    for (const [alias, target] of this.aliases.entries()) {
      const [strategyName, commandName] = target.split(' ', 2);

      // Check if strategy exists
      const strategy = strategyMap.get(strategyName);
      if (!strategy) {
        errors.push(`Alias "${alias}" targets unknown strategy "${strategyName}"`);
        continue;
      }

      // Check if command exists in strategy
      if (!strategy.commands || !strategy.commands[commandName]) {
        errors.push(`Alias "${alias}" targets unknown command "${commandName}" in strategy "${strategyName}"`);
      }
    }

    return errors;
  }

  /**
   * Detect circular aliases
   */
  detectCircular(): string[] {
    const circular: string[] = [];
    const visited = new Set<string>();

    for (const alias of this.aliases.keys()) {
      visited.clear();
      if (this.hasCircularRef(alias, visited)) {
        circular.push(alias);
      }
    }

    return circular;
  }

  private hasCircularRef(alias: string, visited: Set<string>): boolean {
    if (visited.has(alias)) return true;
    visited.add(alias);

    const target = this.aliases.get(alias);
    if (!target) return false;

    // Check if target is itself an alias
    const targetAlias = target.split(' ')[0];
    if (this.aliases.has(targetAlias)) {
      return this.hasCircularRef(targetAlias, visited);
    }

    return false;
  }
}
