import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { trace, Span, SpanStatusCode, context, Context } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { Logger } from './logger';

export interface TelemetryConfig {
  enabled?: boolean;
  projectRoot?: string;
  exportFormat?: 'jsonl';
  serviceName?: string;
  serviceVersion?: string;
}

export interface SpanWrapper {
  end: () => void;
  setAttribute: (key: string, value: string | number | boolean) => void;
  setStatus: (status: { code: SpanStatusCode; message?: string }) => void;
  _spanId?: string; // Internal property for tracking
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

/**
 * OpenTelemetry-based telemetry tracker for xray
 * Tracks command usage, errors, and performance stats
 * Opt-in via config or XRAY_TELEMETRY_ENABLED environment variable
 */
export class TelemetryTracker {
  private enabled: boolean;
  private projectRoot: string;
  private telemetryPath: string = '';
  private provider: NodeTracerProvider | null = null;
  private tracer: ReturnType<typeof trace.getTracer> | null = null;
  private events: TelemetryEvent[] = [];
  private resourceAttrs: Record<string, any>;
  private serviceName: string;
  private serviceVersion: string;

  constructor(config: TelemetryConfig) {
    // Check if telemetry is enabled
    this.enabled = this.isEnabled(config);
    this.projectRoot = config.projectRoot || process.cwd();
    this.serviceName = config.serviceName || 'xray-cli';

    // Try to get version from package.json
    this.serviceVersion = this.getServiceVersion(config.serviceVersion);

    // Setup resource attributes
    this.resourceAttrs = {
      [SEMRESATTRS_SERVICE_NAME]: this.serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: this.serviceVersion,
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

    try {
      // Setup telemetry directory
      const xrayDir = path.join(this.projectRoot, '.xray');
      fs.mkdirSync(xrayDir, { recursive: true });
      this.telemetryPath = path.join(xrayDir, 'telemetry.json');

      // Initialize OpenTelemetry provider
      this.initializeProvider();
    } catch (error) {
      Logger.debug('Failed to initialize telemetry', error);
      this.enabled = false;
    }
  }

  private isEnabled(config: TelemetryConfig): boolean {
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
      const packageJsonPath = path.join(__dirname, '../../package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        return packageJson.version || '0.0.0';
      }
    } catch (error) {
      // Ignore errors
    }

    return '0.0.0';
  }

  private initializeProvider(): void {
    this.provider = new NodeTracerProvider();
    this.provider.register();
    this.tracer = trace.getTracer(this.serviceName, this.serviceVersion);
  }

  /**
   * Track command execution
   */
  trackCommand(commandName: string, options: Record<string, any>): void {
    if (!this.enabled || !this.tracer) return;

    try {
      const attributes: Record<string, any> = {
        'command.name': commandName,
      };

      // Flatten options into attributes
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
   * Start a command span for timing
   */
  startCommandSpan(commandName: string): SpanWrapper {
    if (!this.enabled || !this.tracer) {
      return this.createNoOpSpan();
    }

    try {
      const span = this.tracer.startSpan(commandName, {
        attributes: {
          'span.kind': 'command',
        },
      });

      const startTime = Date.now();
      const spanId = this.generateSpanId();
      const traceId = this.generateTraceId();

      const wrapper: SpanWrapper = {
        _spanId: spanId,
        end: () => {
          const duration = Date.now() - startTime;
          span.end();

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
        setAttribute: (key: string, value: string | number | boolean) => {
          span.setAttribute(key, value);
        },
        setStatus: (status: { code: SpanStatusCode; message?: string }) => {
          span.setStatus(status);
        },
      };

      return wrapper;
    } catch (error) {
      Logger.debug('Failed to start command span', error);
      return this.createNoOpSpan();
    }
  }

  /**
   * Start a generic span with optional parent
   */
  startSpan(name: string, options?: { parent?: SpanWrapper }): SpanWrapper {
    if (!this.enabled || !this.tracer) {
      return this.createNoOpSpan();
    }

    try {
      const span = this.tracer.startSpan(name);
      const startTime = Date.now();
      const spanId = this.generateSpanId();
      const traceId = this.generateTraceId();
      const parentSpanId = options?.parent ? this.extractSpanId(options.parent) : undefined;

      const wrapper: SpanWrapper = {
        _spanId: spanId,
        end: () => {
          const duration = Date.now() - startTime;
          span.end();

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
        setAttribute: (key: string, value: string | number | boolean) => {
          span.setAttribute(key, value);
        },
        setStatus: (status: { code: SpanStatusCode; message?: string }) => {
          span.setStatus(status);
        },
      };

      return wrapper;
    } catch (error) {
      Logger.debug('Failed to start span', error);
      return this.createNoOpSpan();
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

      // Add context attributes
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

      // Add context attributes
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

  /**
   * Shutdown telemetry and flush events to disk
   */
  shutdown(): void {
    if (!this.enabled) return;

    try {
      // Flush events to disk
      if (this.events.length > 0) {
        this.flushEvents();
      }

      // Shutdown provider
      if (this.provider) {
        this.provider.shutdown();
      }
    } catch (error) {
      Logger.debug('Failed to shutdown telemetry', error);
    }
  }

  private recordEvent(event: TelemetryEvent): void {
    this.events.push(event);
  }

  private flushEvents(): void {
    try {
      const lines = this.events.map(event => JSON.stringify(event)).join('\n') + '\n';
      fs.appendFileSync(this.telemetryPath, lines, 'utf-8');
      this.events = [];
    } catch (error) {
      Logger.debug('Failed to flush telemetry events', error);
    }
  }

  private getResourceAttributes(): Record<string, any> {
    return { ...this.resourceAttrs };
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

  private generateSpanId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private generateTraceId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private extractSpanId(span: SpanWrapper): string | undefined {
    return span._spanId;
  }

  private createNoOpSpan(): SpanWrapper {
    return {
      end: () => {},
      setAttribute: () => {},
      setStatus: () => {},
    };
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
