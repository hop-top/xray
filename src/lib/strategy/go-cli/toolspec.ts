// Parse kit's `<tool> spec --format json` output into the xray command model.
//
// Wire shape (kit go/ai/toolspec Manifest, schema 1.x): a flat list of LEAF
// commands, each with a full `path` array (path[0] is the tool name):
//   { tool, version, schema_version, commands: [{ path, short, side_effect,
//     idempotent, flags[], long, retryable, dry_run_supported, ... }] }
// Intermediate (group) nodes are not listed; they are synthesised from paths.
//
// The richer ToolSpec tree (`name` + nested `commands[].children`) is also
// accepted since kit's other adapters emit it.
import { CliCommand, CliFlag, CommandsReport, normalizeReport, sideEffectLevel } from './model';

export class ToolspecParseError extends Error {}

function str(v: any): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function toFlag(f: any): CliFlag | null {
  if (!f || typeof f.name !== 'string') return null;
  return {
    name: f.name,
    shorthand: str(f.short),
    type: str(f.type),
    description: str(f.description),
    default: str(f.default),
  };
}

function toFlags(list: any): CliFlag[] {
  if (!Array.isArray(list)) return [];
  return list.map(toFlag).filter((f): f is CliFlag => f !== null);
}

function manifestCommand(c: any): CliCommand | null {
  if (!c || !Array.isArray(c.path) || c.path.length === 0 || !c.path.every((p: any) => typeof p === 'string')) {
    return null;
  }
  const sideEffect = str(c.side_effect);
  return {
    path: c.path,
    short: str(c.short),
    long: str(c.long),
    flags: toFlags(c.flags),
    hidden: c.hidden === true ? true : undefined,
    deprecated: c.deprecated === true ? true : undefined,
    safety: {
      sideEffect,
      level: sideEffectLevel(sideEffect),
      idempotent: str(c.idempotent),
      retryable: typeof c.retryable === 'boolean' ? c.retryable : undefined,
      dryRunSupported: typeof c.dry_run_supported === 'boolean' ? c.dry_run_supported : undefined,
      destructiveTokenRequired: c.destructive_token_required === true ? true : undefined,
      exitCodes: Array.isArray(c.exit_codes) && c.exit_codes.length ? c.exit_codes : undefined,
    },
  };
}

function walkSpecTree(nodes: any[], prefix: string[], out: CliCommand[]): void {
  for (const n of nodes) {
    if (!n || typeof n.name !== 'string') continue;
    const path = [...prefix, n.name];
    const safety = n.safety || {};
    const contract = n.contract || {};
    out.push({
      path,
      short: str(n.short) || str(n.description),
      aliases: Array.isArray(n.aliases) && n.aliases.length ? n.aliases : undefined,
      flags: toFlags(n.flags),
      deprecated: n.deprecated === true ? true : undefined,
      safety:
        n.safety || n.contract
          ? {
              level: str(safety.level),
              idempotent: typeof contract.idempotent === 'boolean' ? (contract.idempotent ? 'yes' : 'no') : undefined,
              retryable: typeof contract.retryable === 'boolean' ? contract.retryable : undefined,
            }
          : undefined,
    });
    if (Array.isArray(n.children)) walkSpecTree(n.children, path, out);
  }
}

/** Skip kit built-ins that are noise in an application command tree. */
function isBuiltin(path: string[]): boolean {
  const name = path[1];
  return path.length === 2 && (name === 'spec' || name === 'help' || name === 'completion');
}

export function parseToolspec(raw: string): CommandsReport {
  let doc: any;
  try {
    doc = JSON.parse(raw);
  } catch (e: any) {
    throw new ToolspecParseError(`spec output is not valid JSON: ${e.message}`);
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.commands)) {
    throw new ToolspecParseError('spec output has no "commands" array');
  }
  const tool = str(doc.tool) || str(doc.name);
  if (!tool) throw new ToolspecParseError('spec output has no "tool"/"name"');

  const all: CliCommand[] = [];
  const isManifest = doc.commands.length > 0 && doc.commands.every((c: any) => c && Array.isArray(c.path));
  if (isManifest) {
    for (const c of doc.commands) {
      const cmd = manifestCommand(c);
      if (!cmd) throw new ToolspecParseError('spec command has an invalid "path"');
      all.push(cmd);
    }
  } else {
    walkSpecTree(doc.commands, [tool], all);
  }
  const leaves = all.filter(c => !isBuiltin(c.path));

  // Synthesize the root plus any intermediate group nodes.
  const byKey = new Map<string, CliCommand>();
  for (const c of leaves) byKey.set(c.path.join('\0'), c);
  const ensure = (path: string[]): void => {
    if (!byKey.has(path.join('\0'))) byKey.set(path.join('\0'), { path, flags: [] });
  };
  for (const c of leaves) {
    for (let d = 1; d < c.path.length; d++) ensure(c.path.slice(0, d));
  }
  ensure([tool]);

  return normalizeReport({
    source: 'toolspec',
    tool,
    version: str(doc.version),
    schemaVersion: str(doc.schema_version) || str(doc.schemaVersion),
    commands: [...byKey.values()],
    warnings: [],
  });
}
