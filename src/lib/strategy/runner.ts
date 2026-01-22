// src/strategy/runner.ts
import { Strategy, StrategyContext } from './types';

export class StrategyRunner {
  private strategies: Map<string, Strategy>;

  constructor() {
    this.strategies = new Map();
  }

  /**
   * Register a strategy with the command runner
   */
  register(strategy: Strategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Execute a command for a specific strategy
   * @param strategyName Name of the strategy
   * @param commandName Name of the command
   * @param ctx Strategy context
   * @param options Command options
   * @returns Command result
   */
  async execute(
    strategyName: string,
    commandName: string,
    ctx: StrategyContext,
    options?: any
  ): Promise<any> {
    const strategy = this.strategies.get(strategyName);

    if (!strategy) {
      throw new Error(`Strategy "${strategyName}" not found`);
    }

    if (!strategy.commands || !strategy.commands[commandName]) {
      throw new Error(
        `Command "${commandName}" not found for strategy "${strategyName}"`
      );
    }

    const command = strategy.commands[commandName];
    return await command.handler(ctx, options);
  }

  /**
   * List all available commands for a strategy
   * @param strategyName Name of the strategy
   * @returns Array of command names with descriptions
   */
  listCommands(strategyName: string): Array<{ name: string; description: string }> {
    const strategy = this.strategies.get(strategyName);

    if (!strategy) {
      throw new Error(`Strategy "${strategyName}" not found`);
    }

    if (!strategy.commands) {
      return [];
    }

    return Object.entries(strategy.commands).map(([name, cmd]) => ({
      name,
      description: cmd.description
    }));
  }

  /**
   * Check if a strategy has commands
   * @param strategyName Name of the strategy
   * @returns True if strategy has commands
   */
  hasCommands(strategyName: string): boolean {
    const strategy = this.strategies.get(strategyName);
    return !!(strategy && strategy.commands && Object.keys(strategy.commands).length > 0);
  }

  /**
   * Get all registered strategy names
   * @returns Array of strategy names
   */
  getRegisteredStrategies(): string[] {
    return Array.from(this.strategies.keys());
  }
}
