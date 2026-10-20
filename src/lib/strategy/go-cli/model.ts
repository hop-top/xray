// Command model shared by the toolspec and AST extraction paths.

export type CommandSource = 'toolspec' | 'ast';

export interface CliFlag {
  name: string;
  shorthand?: string;
  type?: string;
  description?: string;
  default?: string;
  persistent?: boolean;
}

/** Safety/contract metadata; only the toolspec path can populate this. */
export interface CliSafety {
  sideEffect?: string;
  /** Derived from sideEffect with kit's tier ladder: safe | caution | dangerous. */
  level?: string;
  idempotent?: string;
  retryable?: boolean;
  dryRunSupported?: boolean;
  destructiveTokenRequired?: boolean;
  exitCodes?: string[];
}

export interface CliCommand {
  path: string[];
  short?: string;
  long?: string;
  aliases?: string[];
  flags: CliFlag[];
  hidden?: boolean;
  deprecated?: boolean;
  safety?: CliSafety;
  /** AST path only: project-relative file and 1-based line of the definition. */
  file?: string;
  line?: number;
}

export interface CommandsReport {
  source: CommandSource;
  tool: string;
  version?: string;
  schemaVersion?: string;
  commands: CliCommand[];
  warnings: string[];
}

/** kit side-effect tier -> coarse level (mirrors toolspec README table). */
export function sideEffectLevel(sideEffect: string | undefined): string | undefined {
  if (!sideEffect) return undefined;
  if (sideEffect === 'read') return 'safe';
  if (sideEffect.startsWith('destructive')) return 'dangerous';
  if (sideEffect.startsWith('write') || sideEffect === 'interactive') return 'caution';
  return undefined;
}

function cmpPath(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/** Stable ordering: commands by path, flags by name. Mutates and returns the report. */
export function normalizeReport(report: CommandsReport): CommandsReport {
  for (const c of report.commands) {
    c.flags.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (c.aliases) c.aliases = [...c.aliases].sort();
  }
  report.commands.sort((a, b) => cmpPath(a.path, b.path));
  report.warnings = [...new Set(report.warnings)];
  return report;
}

/** Drop undefined/empty optionals so JSON output is minimal and stable. */
function clean<T extends object>(o: T): T {
  const out: any = {};
  for (const k of Object.keys(o)) {
    const v = (o as any)[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0 && k !== 'flags') continue;
    out[k] = v;
  }
  return out;
}

export function renderJson(report: CommandsReport): string {
  const out = {
    source: report.source,
    tool: report.tool,
    ...(report.version ? { version: report.version } : {}),
    ...(report.schemaVersion ? { schemaVersion: report.schemaVersion } : {}),
    commands: report.commands.map(c =>
      clean({
        path: c.path,
        short: c.short || undefined,
        long: c.long || undefined,
        aliases: c.aliases,
        hidden: c.hidden || undefined,
        deprecated: c.deprecated || undefined,
        flags: c.flags.map(f => clean({ ...f, persistent: f.persistent || undefined })),
        safety: c.safety ? clean(c.safety) : undefined,
        file: c.file,
        line: c.line,
      })
    ),
    warnings: report.warnings,
  };
  return JSON.stringify(out, null, 2);
}

function flagLabel(f: CliFlag): string {
  const names = (f.shorthand ? `-${f.shorthand}, ` : '') + `--${f.name}`;
  return f.type && f.type !== 'bool' ? `${names} <${f.type}>` : names;
}

export function renderText(report: CommandsReport): string {
  const lines: string[] = [];
  const via = report.source === 'toolspec' ? 'kit toolspec (spec --format json)' : 'AST (tree-sitter-go)';
  lines.push(`${report.tool} commands [source: ${via}]`);
  if (report.commands.length === 0) lines.push('  (no commands found)');

  const childrenOf = (path: string[]): CliCommand[] =>
    report.commands.filter(
      c => c.path.length === path.length + 1 && path.every((p, k) => c.path[k] === p)
    );
  const describe = (c: CliCommand): string => {
    let line = c.path[c.path.length - 1];
    if (c.short) line += `  ${c.short}`;
    const tags: string[] = [];
    if (c.safety?.sideEffect) tags.push(c.safety.sideEffect);
    if (c.hidden) tags.push('hidden');
    if (c.deprecated) tags.push('deprecated');
    if (tags.length) line += `  [${tags.join(', ')}]`;
    if (c.file) line += `  (${c.file}${c.line ? ':' + c.line : ''})`;
    return line;
  };
  const emit = (c: CliCommand, head: string, rest: string): void => {
    lines.push(head + describe(c));
    const kids = childrenOf(c.path);
    const bar = kids.length ? '│  ' : '   ';
    for (const f of c.flags) lines.push(`${rest}${bar}  ${flagLabel(f)}${f.description ? '  ' + f.description : ''}`);
    kids.forEach((k, i) => {
      const lastKid = i === kids.length - 1;
      emit(k, rest + (lastKid ? '└─ ' : '├─ '), rest + (lastKid ? '   ' : '│  '));
    });
  };
  // Roots: commands whose parent path is not itself a listed command.
  const known = new Set(report.commands.map(c => c.path.join('\0')));
  for (const r of report.commands.filter(c => c.path.length === 1 || !known.has(c.path.slice(0, -1).join('\0')))) {
    emit(r, '', '');
  }
  for (const w of report.warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}
