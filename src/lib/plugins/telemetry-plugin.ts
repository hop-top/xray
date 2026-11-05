import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { XrayPlugin } from '../events/plugin';
import { AsyncEventEmitter } from '../events/async-emitter';
import { XrayEvents } from '../events/types';
import { Logger } from '../logger';
import { telemetryOffReason } from '../telemetry-policy';
import { projectTelemetryPath, ensurePrivateDir, ensurePrivateFile } from '../storage';

export interface TelemetryConfig {
  enabled?: boolean;
  projectRoot?: string;
  exportFormat?: 'jsonl';
  serviceName?: string;
  serviceVersion?: string;
}

interface TelemetryEvent {
  name: string;
  timestamp: number;
  kind?: string;
  attributes?: Record<string, any>;
  resource?: Record<string, any>;
  spanId?: string;
  traceId?: string;
  parentSpanId?: string;
  duration?: number;
}

interface CommandContext {
  startTime: number;
  traceId: string;
  command: string;
  options: Record<string, any>;
}

/**
 * TelemetryPlugin - Event-based telemetry tracker
 * Listens to xray lifecycle events and records telemetry data
 * Opt-in via config or XRAY_TELEMETRY_ENABLED environment variable
 */
export class TelemetryPlugin implements XrayPlugin {
  name = 'telemetry';
  version = '1.0.0';

  private enabled: boolean;
  private telemetryPath: string = '';
  private events: TelemetryEvent[] = [];
  private resourceAttrs: Record<string, any>;
  private activeCommands: Map<string, CommandContext> = new Map();
  private serviceName: string;
  private serviceVersion: string;

  constructor(config: TelemetryConfig) {
    // Check if telemetry is enabled
    this.enabled = this.isEnabled(config);
    const projectRoot = config.projectRoot || process.cwd();
    this.serviceName = config.serviceName || 'xray-cli';

    // Try to get version from package.json
    this.serviceVersion = this.getServiceVersion(config.serviceVersion);

    // Setup resource attributes
    this.resourceAttrs = {
      'service.name': this.serviceName,
      'service.version': this.serviceVersion,
      'host.arch': os.arch(),
      'os.type': os.type(),
      'os.version': os.release(),
      'process.pid': process.pid,
      'process.node_version': process.version,
    };

    if (!this.enabled) {
      Logger.debug('Telemetry is disabled');
      return;
    }

    // The sink lives in the user state dir, keyed by project root: never in
    // the project. The dir is created on first flush, so a run that records
    // nothing creates nothing.
    const sink = projectTelemetryPath(projectRoot);
    if (!sink) {
      Logger.debug('Telemetry off: no usable state directory');
      this.enabled = false;
      return;
    }
    this.telemetryPath = sink;
  }

  private isEnabled(config: TelemetryConfig): boolean {
    // Forced off (subprocess, pipe, CI, MCP, machine format, flag, env)
    // beats config and consent: no recorder can bypass it.
    const off = telemetryOffReason();
    if (off !== null) {
      Logger.debug(`Telemetry off for this run (${off})`);
      return false;
    }

    // Explicit config takes precedence
    if (config.enabled !== undefined) {
      return config.enabled;
    }

    // Check environment variable
    const envEnabled = process.env.XRAY_TELEMETRY_ENABLED;
    if (envEnabled !== undefined) {
      return envEnabled === 'true' || envEnabled === '1';
    }

    // Default: disabled (opt-in)
    return false;
  }

  private getServiceVersion(configVersion?: string): string {
    if (configVersion) {
      return configVersion;
    }

    try {
      const packageJsonPath = path.join(__dirname, '../../../package.json');
      if (fs.existsSync(packageJsonPath)) {
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content);
        return packageJson.version || '0.0.0';
      }
    } catch (error) {
      // Ignore errors - version is optional for telemetry
    }

    return '0.0.0';
  }

  apply(xray: AsyncEventEmitter<XrayEvents>): void {
    if (!this.enabled) {
      return;
    }

    // Register event listeners
    xray.on('command:start', this.handleCommandStart.bind(this));
    xray.on('command:complete', this.handleCommandComplete.bind(this));
    xray.on('command:error', this.handleCommandError.bind(this));
    xray.on('stat:recorded', this.handleStat.bind(this));
    xray.on('cache:hit', () => this.recordEvent({ name: 'cache.hit', timestamp: Date.now() }));
    xray.on('cache:miss', () => this.recordEvent({ name: 'cache.miss', timestamp: Date.now() }));
    xray.on('parse:error', (e) => this.handleParseError(e));
    xray.on('error', (e) => this.handleError(e));
  }

  dispose(): void {
    if (this.enabled) {
      this.flushEvents();
    }
  }

  private handleCommandStart(event: XrayEvents['command:start']): void {
    const ctx: CommandContext = {
      startTime: Date.now(),
      traceId: event.traceId,
      command: event.command,
      options: event.options
    };
    this.activeCommands.set(event.traceId, ctx);

    // Track command.execute event
    const attributes: Record<string, any> = {
      'command.name': event.command,
    };

    // Flatten options into attributes
    Object.entries(event.options).forEach(([key, value]) => {
      const attrKey = `command.options.${key}`;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        attributes[attrKey] = value;
      } else if (value !== null && value !== undefined) {
        attributes[attrKey] = JSON.stringify(value);
      }
    });

    this.recordEvent({
      name: 'command.execute',
      timestamp: ctx.startTime,
      attributes,
      traceId: ctx.traceId,
      resource: this.getResourceAttributes()
    });
  }

  private handleCommandComplete(event: XrayEvents['command:complete']): void {
    const ctx = this.activeCommands.get(event.traceId);
    if (!ctx) return;

    const duration = Date.now() - ctx.startTime;
    this.recordEvent({
      name: ctx.command,
      kind: 'span',
      timestamp: ctx.startTime,
      duration,
      traceId: ctx.traceId,
      spanId: this.generateSpanId(),
      attributes: { 'span.kind': 'command', success: event.success },
      resource: this.getResourceAttributes()
    });

    this.activeCommands.delete(event.traceId);
  }

  private handleCommandError(event: XrayEvents['command:error']): void {
    const attributes: Record<string, any> = {
      'error.type': event.errorType,
      'error.message': event.error.message,
      'error.stack': event.error.stack,
    };

    // Add context attributes
    if (event.context) {
      Object.entries(event.context).forEach(([key, value]) => {
        const attrKey = `error.context.${key}`;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          attributes[attrKey] = value;
        } else if (value !== null && value !== undefined) {
          attributes[attrKey] = JSON.stringify(value);
        }
      });
    }

    this.recordEvent({
      name: 'error.occurred',
      timestamp: Date.now(),
      attributes,
      traceId: event.traceId,
      resource: this.getResourceAttributes()
    });
  }

  private handleStat(event: XrayEvents['stat:recorded']): void {
    const attributes: Record<string, any> = {
      'stat.name': event.name,
      'stat.value': event.value,
      'stat.unit': event.unit,
    };

    // Add context attributes
    if (event.context) {
      Object.entries(event.context).forEach(([key, value]) => {
        const attrKey = `stat.context.${key}`;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          attributes[attrKey] = value;
        } else if (value !== null && value !== undefined) {
          attributes[attrKey] = JSON.stringify(value);
        }
      });
    }

    this.recordEvent({
      name: 'stat.recorded',
      timestamp: Date.now(),
      attributes,
      resource: this.getResourceAttributes()
    });
  }

  private handleParseError(event: XrayEvents['parse:error']): void {
    this.recordEvent({
      name: 'error.occurred',
      timestamp: Date.now(),
      attributes: {
        'error.type': 'ParseError',
        'error.message': event.error.message,
        'error.stack': event.error.stack,
        'error.context.file': event.file,
        'error.context.recovered': event.recovered
      },
      resource: this.getResourceAttributes()
    });
  }

  private handleError(event: XrayEvents['error']): void {
    this.recordEvent({
      name: 'error.occurred',
      timestamp: Date.now(),
      attributes: {
        'error.type': event.event,
        'error.message': event.error.message,
        'error.stack': event.error.stack,
        'error.context.recovered': event.recovered,
        'error.context.payload': JSON.stringify(event.payload)
      },
      resource: this.getResourceAttributes()
    });
  }

  private recordEvent(event: TelemetryEvent): void {
    this.events.push(event);
  }

  private flushEvents(): void {
    if (!this.enabled || this.events.length === 0) {
      return;
    }

    try {
      const lines = this.events.map(event => JSON.stringify(event)).join('\n') + '\n';
      // The sink holds usage detail: private dir (0700) and file (0600), or
      // nothing is written.
      if (!ensurePrivateDir(path.dirname(this.telemetryPath)) || !ensurePrivateFile(this.telemetryPath)) {
        Logger.debug('Telemetry not written: state directory cannot be made private');
        this.events = [];
        return;
      }
      fs.appendFileSync(this.telemetryPath, lines, 'utf-8');
      this.events = [];
    } catch (error) {
      Logger.debug('Failed to flush telemetry events', error);
    }
  }

  private getResourceAttributes(): Record<string, any> {
    return { ...this.resourceAttrs };
  }

  private generateSpanId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * Shutdown telemetry and flush events to disk
   */
  shutdown(): void {
    if (this.enabled) {
      this.flushEvents();
    }
  }

  /**
   * Track command execution
   */
  trackCommand(commandName: string, options: Record<string, any>): void {
    if (!this.enabled) return;

    try {
      const attributes: Record<string, any> = {
        'command.name': commandName,
      };

      Object.entries(options).forEach(([key, value]) => {
        const attrKey = `command.options.${key}`;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          attributes[attrKey] = value;
        } else if (value !== null && value !== undefined) {
          attributes[attrKey] = JSON.stringify(value);
        }
      });

      this.recordEvent({
        name: 'command.execute',
        timestamp: Date.now(),
        attributes,
        resource: this.getResourceAttributes(),
      });
    } catch (error) {
      Logger.debug('Failed to track command', error);
    }
  }

  /**
   * Track error events
   */
  trackError(errorType: string, error: Error, context?: Record<string, any>): void {
    if (!this.enabled) return;

    try {
      const attributes: Record<string, any> = {
        'error.type': errorType,
        'error.message': error.message,
        'error.stack': error.stack,
      };

      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          const attrKey = `error.context.${key}`;
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            attributes[attrKey] = value;
          } else if (value !== null && value !== undefined) {
            attributes[attrKey] = JSON.stringify(value);
          }
        });
      }

      this.recordEvent({
        name: 'error.occurred',
        timestamp: Date.now(),
        attributes,
        resource: this.getResourceAttributes(),
      });
    } catch (err) {
      Logger.debug('Failed to track error', err);
    }
  }

  /**
   * Track statistical metrics
   */
  trackStat(name: string, value: number, context?: Record<string, any>): void {
    if (!this.enabled) return;

    try {
      const attributes: Record<string, any> = {
        'stat.name': name,
        'stat.value': value,
        'stat.unit': this.inferUnit(name, context),
      };

      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          const attrKey = `stat.context.${key}`;
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            attributes[attrKey] = value;
          } else if (value !== null && value !== undefined) {
            attributes[attrKey] = JSON.stringify(value);
          }
        });
      }

      this.recordEvent({
        name: 'stat.recorded',
        timestamp: Date.now(),
        attributes,
        resource: this.getResourceAttributes(),
      });
    } catch (error) {
      Logger.debug('Failed to track stat', error);
    }
  }

  private inferUnit(name: string, context?: Record<string, any>): string {
    if (context?.unit) {
      return context.unit;
    }

    if (name.includes('time') || name.includes('duration')) {
      return 'ms';
    }

    if (name.includes('memory') || name.includes('size') || name.includes('bytes')) {
      return 'bytes';
    }

    if (name.includes('files') || name.includes('lines') || name.includes('count')) {
      return 'count';
    }

    return 'unit';
  }

  /**
   * Start a command span for timing
   */
  startCommandSpan(commandName: string): { end: () => void; setAttribute: (k: string, v: any) => void; setStatus: (s: any) => void; _spanId?: string } {
    if (!this.enabled) {
      return this.createNoOpSpan();
    }

    const startTime = Date.now();
    const spanId = this.generateSpanId();
    const traceId = this.generateTraceId();

    return {
      _spanId: spanId,
      end: () => {
        const duration = Date.now() - startTime;
        this.recordEvent({
          name: commandName,
          timestamp: startTime,
          kind: 'span',
          attributes: {
            'span.kind': 'command',
          },
          resource: this.getResourceAttributes(),
          spanId,
          traceId,
          duration,
        });
      },
      setAttribute: () => {},
      setStatus: () => {},
    };
  }

  /**
   * Start a generic span
   */
  startSpan(name: string, options?: { parent?: any }): { end: () => void; setAttribute: (k: string, v: any) => void; setStatus: (s: any) => void; _spanId?: string } {
    if (!this.enabled) {
      return this.createNoOpSpan();
    }

    const startTime = Date.now();
    const spanId = this.generateSpanId();
    const traceId = this.generateTraceId();
    const parentSpanId = options?.parent?._spanId;

    return {
      _spanId: spanId,
      end: () => {
        const duration = Date.now() - startTime;
        this.recordEvent({
          name,
          timestamp: startTime,
          kind: 'span',
          resource: this.getResourceAttributes(),
          spanId,
          traceId,
          parentSpanId,
          duration,
        });
      },
      setAttribute: () => {},
      setStatus: () => {},
    };
  }

  private generateTraceId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private createNoOpSpan() {
    return {
      end: () => {},
      setAttribute: () => {},
      setStatus: () => {},
    };
  }
}
