/**
 * Terminal styling + progress on top of `@hop-top/kit/tui`.
 *
 * Kit's TUI primitives always emit ANSI, so this module owns the color
 * policy and hands kit only the cases where styling is allowed.
 *
 * Color policy, per stream, first match wins:
 *   1. `--no-color` (flag on argv or `disableColor()` from the root hook) → off
 *   2. `NO_COLOR` set                                                    → off
 *   3. `FORCE_COLOR` set (not `0` / `false`)                             → on
 *   4. stream is a TTY                                                   → on, else off
 *
 * Progress policy: no output under `quiet`, none on a non-TTY stream
 * (no redraws in pipes / logs); kit bar when color is on, plain bar
 * (same glyphs, no ANSI) when color is off.
 */
import type { Theme } from '@hop-top/kit/dist/cli';
import type * as KitTui from '@hop-top/kit/dist/tui';

// Legacy `node` module resolution ignores kit's `exports` map; the
// runtime require goes through the exported subpath. Loaded lazily: the
// kit/tui bundle eagerly requires an ESM-only prompt library, which only
// loads under require(esm), and plain styling never needs it.
let kitTuiMod: typeof KitTui | undefined;
function kitTui(): typeof KitTui {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (kitTuiMod ??= require('@hop-top/kit/tui') as typeof KitTui);
}

let activeTheme: Theme | undefined;
let colorOff = false;

/** Install the root program's theme (called once by the root builder). */
export function setTheme(theme: Theme): void {
  activeTheme = theme;
}

/** Active theme; falls back to kit's default when no root program exists. */
export function getTheme(): Theme {
  if (!activeTheme) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildTheme } = require('@hop-top/kit/cli') as typeof import('@hop-top/kit/dist/cli');
    activeTheme = buildTheme();
  }
  return activeTheme;
}

/** Force color off for the rest of the process (`--no-color`). */
export function disableColor(off = true): void {
  colorOff = off;
}

/** Whether color was forced off via `disableColor()`. */
export function colorForcedOff(): boolean {
  return colorOff;
}

type Stream = NodeJS.WritableStream & { isTTY?: boolean };

/** Whether ANSI styling may be written to `stream`. */
export function colorEnabled(stream: Stream = process.stdout): boolean {
  if (colorOff || process.argv.includes('--no-color')) return false;
  if (process.env.NO_COLOR !== undefined) return false;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== '0' && force !== 'false') return true;
  return Boolean(stream.isTTY);
}

function sgr(open: string, text: string): string {
  return `\x1b[${open}m${text}\x1b[0m`;
}

function fg(hex: string, text: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return sgr(`38;2;${r};${g};${b}`, text);
}

type Painter = (text: string) => string;

export interface Styles {
  /** Primary accent: names, headings. */
  accent: Painter;
  /** Dim secondary detail: versions, paths, hints. */
  muted: Painter;
  success: Painter;
  error: Painter;
  /** Warning / attention (theme secondary, as kit `status` warn). */
  warn: Painter;
  bold: Painter;
}

/**
 * Theme-backed painters for `stream`; identity functions when color is
 * off for that stream. Resolve per write site, not at module load.
 */
export function styles(stream: Stream = process.stdout): Styles {
  if (!colorEnabled(stream)) {
    const id: Painter = (t) => t;
    return { accent: id, muted: id, success: id, error: id, warn: id, bold: id };
  }
  const t = getTheme();
  return {
    accent: (s) => fg(t.accent, s),
    muted: (s) => fg(t.muted, s),
    success: (s) => fg(t.success, s),
    error: (s) => fg(t.error, s),
    warn: (s) => fg(t.secondary, s),
    bold: (s) => sgr('1', s),
  };
}

/** Kit status line (`✓ text`), plain when color is off for `stream`. */
export function statusLine(
  text: string,
  kind: KitTui.StatusKind = 'info',
  stream: Stream = process.stdout
): string {
  const line = kitTui().status(getTheme(), text, kind);
  return colorEnabled(stream) ? line : stripAnsi(line);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

export interface FileProgress {
  update(current: number, total: number, detail?: string): void;
  stop(): void;
}

export interface FileProgressOpts {
  /** Prefix shown before the counts, e.g. `Parsing`. */
  label: string;
  /** Suppress all progress output. */
  quiet?: boolean;
  /** Target stream (kit bar always draws on stderr). */
  stream?: Stream;
}

const NOOP: FileProgress = { update() {}, stop() {} };

/**
 * Counted progress bar for file loops. No-op under `quiet` or on a
 * non-TTY stream; stops itself once `current >= total`.
 */
export function fileProgress(opts: FileProgressOpts): FileProgress {
  const stream = opts.stream ?? process.stderr;
  if (opts.quiet || !stream.isTTY) return NOOP;

  const useKit = colorEnabled(stream) && stream === process.stderr;
  const bar = useKit ? kitTui().progress(getTheme()) : undefined;
  let running = false;

  const message = (current: number, total: number, detail?: string) =>
    `${opts.label} ${current}/${total}${detail ? ` ${detail}` : ''}`;

  const stop = () => {
    if (!running) return;
    running = false;
    if (bar) bar.stop();
    else stream.write('\r\x1b[K');
  };

  return {
    update(current, total, detail) {
      const ratio = total > 0 ? current / total : 1;
      const msg = message(current, total, detail);
      if (bar) {
        if (!running) bar.start();
        bar.update(ratio, msg);
      } else {
        const pct = Math.round(kitTui().clamp01(ratio) * 100);
        stream.write(`\r\x1b[K${kitTui().renderBarPlain(ratio)} ${pct}% ${msg}`);
      }
      running = true;
      if (current >= total) stop();
    },
    stop,
  };
}
