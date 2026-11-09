/**
 * Diagnostics logger on top of `@hop-top/kit/log`.
 *
 * Kit owns level filtering and dispatch; xray owns the line format
 * (glyph + message, colored via `./tui` so the shared color policy
 * applies) and the threshold, resolved from `--quiet` / `--log-level` /
 * `-V` by the root hook and handed in through `setLevel`. Kit's own
 * `quiet` (warn+error) is never used: xray's `--quiet` means errors only.
 *
 * Every line goes to stderr through `console.error` / `console.warn`;
 * stdout carries data only (`Logger.output`).
 */
import { terminalSafeBlock } from './terminal-safe';
import { format } from 'util';
import type * as KitLog from '@hop-top/kit/dist/log';
import { styles } from './tui';

export enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4
}

type KitLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const KIT_LEVELS: Record<LogLevel, KitLevel> = {
  [LogLevel.SILENT]: 'silent',
  [LogLevel.ERROR]: 'error',
  [LogLevel.WARN]: 'warn',
  [LogLevel.INFO]: 'info',
  [LogLevel.DEBUG]: 'debug'
};

/** Field marking lines rendered without a glyph. */
const SHAPE = 'xrayShape';
type Shape = 'plain' | 'detail';

// Legacy `node` module resolution ignores kit's `exports` map; the runtime
// require goes through the exported subpath. Loaded on first log line so
// commands that never log skip pino's startup cost.
let kitLogMod: typeof KitLog | undefined;
function kitLog(): typeof KitLog {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (kitLogMod ??= require('@hop-top/kit/log') as typeof KitLog);
}

/** Render one record as xray's `<glyph> <message>` line. */
function render(rec: KitLog.LogRecord): string {
  const paint = styles(process.stderr);
  const shape = rec.fields[SHAPE] as Shape | undefined;
  // Messages carry repo-controlled text (paths, package errors): escape
  // control sequences before any styling, keeping newlines. Callers pass
  // plain text; the level supplies the color.
  const msg = terminalSafeBlock(rec.msg);
  if (shape === 'plain') return msg;
  if (shape === 'detail') return paint.error(msg);
  if (rec.kind === 'success') return paint.success('✔') + ' ' + msg;
  switch (rec.level) {
    case 'debug':
      return paint.muted('◆') + ' ' + msg;
    case 'warn':
      return paint.warn('⚠') + ' ' + msg;
    case 'error':
      return paint.error('✖') + ' ' + msg;
    default:
      return paint.accent('ℹ') + ' ' + msg;
  }
}

/**
 * Build a kit logger at `level`. The formatter runs synchronously right
 * before the sink write, so it records the line's level for the sink to
 * pick `console.warn` vs `console.error` (both stderr). The formatter
 * always terminates the line itself (kit only adds `\n` when missing), so
 * the sink strips exactly one and a message's own trailing newline stays.
 */
function buildKitLogger(level: KitLevel): KitLog.Logger {
  let lineLevel: KitLog.LogLevelName = 'info';
  return kitLog().createLogger({
    level,
    formatter: (rec) => {
      lineLevel = rec.level;
      return render(rec) + '\n';
    },
    output: {
      write: (chunk: string) => {
        const line = chunk.slice(0, -1);
        if (lineLevel === 'warn') console.warn(line);
        else console.error(line);
      }
    }
  });
}

export class Logger {
  private static level: LogLevel = LogLevel.INFO;
  private static kit: KitLog.Logger | undefined;

  static setLevel(level: LogLevel | string): void {
    if (typeof level === 'string') {
      const levelMap: Record<string, LogLevel> = {
        'silent': LogLevel.SILENT,
        'error': LogLevel.ERROR,
        'warn': LogLevel.WARN,
        'info': LogLevel.INFO,
        'debug': LogLevel.DEBUG
      };
      this.level = levelMap[level.toLowerCase()] ?? LogLevel.INFO;
    } else {
      this.level = level;
    }
    this.kit = undefined;
  }

  static getLevel(): LogLevel {
    return this.level;
  }

  private static sink(): KitLog.Logger {
    return (this.kit ??= buildKitLogger(KIT_LEVELS[this.level] ?? 'info'));
  }

  static debug(message: string, ...args: any[]): void {
    this.sink().debug(args.length ? format(message, ...args) : String(message));
  }

  static info(message: string): void {
    this.sink().info(String(message));
  }

  static success(message: string): void {
    this.sink().success(String(message));
  }

  static warn(message: string): void {
    this.sink().warn(String(message));
  }

  static error(message: string, error?: any): void {
    const kit = this.sink();
    kit.error(String(message));
    if (error) {
      kit.error(String(error), SHAPE, 'detail');
    }
  }

  static log(message: string): void {
    this.sink().info(String(message), SHAPE, 'plain');
  }

  /**
   * Unconditional output - bypasses log level filtering
   * Use for command results, data output, and user-requested information
   * Should NOT be used for status messages or diagnostics
   */
  static output(message: string): void {
    console.log(message);
  }
}
