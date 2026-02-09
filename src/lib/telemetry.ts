import { TelemetryPlugin, TelemetryConfig } from './plugins/telemetry-plugin';

export { TelemetryConfig } from './plugins/telemetry-plugin';

export interface SpanWrapper {
  end: () => void;
  setAttribute: (key: string, value: string | number | boolean) => void;
  setStatus: (status: { code: number; message?: string }) => void;
  _spanId?: string;
}

export class TelemetryTracker {
  private plugin: TelemetryPlugin;

  constructor(config: TelemetryConfig) {
    this.plugin = new TelemetryPlugin(config);
  }

  trackCommand(commandName: string, options: Record<string, any>): void {
    this.plugin.trackCommand(commandName, options);
  }

  startCommandSpan(commandName: string): SpanWrapper {
    return this.plugin.startCommandSpan(commandName);
  }

  startSpan(name: string, options?: { parent?: SpanWrapper }): SpanWrapper {
    return this.plugin.startSpan(name, options);
  }

  trackError(errorType: string, error: Error, context?: Record<string, any>): void {
    this.plugin.trackError(errorType, error, context);
  }

  trackStat(name: string, value: number, context?: Record<string, any>): void {
    this.plugin.trackStat(name, value, context);
  }

  shutdown(): void {
    this.plugin.shutdown();
  }
}

// Export a singleton instance helper
let globalTracker: TelemetryTracker | null = null;

export function initializeTelemetry(config: TelemetryConfig): TelemetryTracker {
  if (globalTracker) {
    globalTracker.shutdown();
  }
  globalTracker = new TelemetryTracker(config);
  return globalTracker;
}

export function getTelemetryTracker(): TelemetryTracker | null {
  return globalTracker;
}

export function shutdownTelemetry(): void {
  if (globalTracker) {
    globalTracker.shutdown();
    globalTracker = null;
  }
}
