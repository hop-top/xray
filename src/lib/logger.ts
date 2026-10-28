import { styles } from './tui';

export enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4
}

export class Logger {
  private static level: LogLevel = LogLevel.INFO;

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
  }

  static getLevel(): LogLevel {
    return this.level;
  }

  static debug(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.DEBUG) {
      console.error(styles(process.stderr).muted('◆') + ' ' + message, ...args);
    }
  }

  static info(message: string): void {
    if (this.level >= LogLevel.INFO) {
      console.error(styles(process.stderr).accent('ℹ') + ' ' + message);
    }
  }

  static success(message: string): void {
    if (this.level >= LogLevel.INFO) {
      console.error(styles(process.stderr).success('✔') + ' ' + message);
    }
  }

  static warn(message: string): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(styles(process.stderr).warn('⚠') + ' ' + message);
    }
  }

  static error(message: string, error?: any): void {
    if (this.level >= LogLevel.ERROR) {
      const paint = styles(process.stderr);
      console.error(paint.error('✖') + ' ' + message);
      if (error) {
        console.error(paint.error(String(error)));
      }
    }
  }

  static log(message: string): void {
    if (this.level >= LogLevel.INFO) {
      console.error(message);
    }
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
