import type { Cfg, Dfg } from './types';
import { terminalSafe } from '../terminal-safe';

/**
 * Compact text of a function's flow, one line per CFG node and per
 * definition, for the map's text output. Lines are 1-based (`L12`);
 * `→` separates a CFG node from its successors (`n4:true` = edge label),
 * a definition from the CFG nodes that read it.
 *
 *   cfg
 *     n0 entry L3 → n2
 *     n2 cond L4 a > 0 → n3:true n4:false
 *   dfg
 *     d0 a param L3 → n2
 */
export function flowLines(flow: { cfg?: Cfg; dfg?: Dfg }, indent = '  '): string[] {
  const out: string[] = [];
  if (flow.cfg) cfgLines(flow.cfg, indent, out);
  if (flow.dfg) dfgLines(flow.dfg, indent, out, !flow.cfg);
  return out;
}

function cfgLines(cfg: Cfg, indent: string, out: string[]): void {
  const succ = new Map<string, string[]>();
  for (const e of cfg.edges) {
    const list = succ.get(e.from) ?? [];
    list.push(e.label ? `${e.to}:${e.label}` : e.to);
    succ.set(e.from, list);
  }
  out.push(`${indent}cfg${cfg.truncated ? ` (truncated: ${cfg.truncated.limit} of ${cfg.truncated.nodes}${cfg.truncated.partial ? '+' : ''} nodes)` : ''}`);
  for (const n of cfg.nodes) {
    const label = n.kind === 'entry' || n.kind === 'exit' ? '' : ` ${terminalSafe(n.label)}`;
    const next = succ.get(n.id);
    out.push(`${indent}${indent}${n.id} ${n.kind} L${n.line + 1}${label}${next ? ` → ${next.join(' ')}` : ''}`);
  }
  for (const c of cfg.closures ?? []) {
    out.push(`${indent}closure ${terminalSafe(c.name)} L${c.line + 1}`);
    const inner: string[] = [];
    cfgLines(c, indent, inner);
    out.push(...inner.map(l => indent + l));
  }
}

function dfgLines(dfg: Dfg, indent: string, out: string[], withSites: boolean): void {
  const uses = new Map<string, string[]>();
  for (const e of dfg.edges) {
    const list = uses.get(e.from) ?? [];
    list.push(e.to);
    uses.set(e.from, list);
  }
  out.push(`${indent}dfg${dfg.truncated ? ` (truncated: ${dfg.truncated.limit} of ${dfg.truncated.nodes}${dfg.truncated.partial ? '+' : ''} nodes)` : ''}`);
  if (withSites) for (const s of dfg.sites) out.push(`${indent}${indent}${s.id} L${s.line + 1} ${terminalSafe(s.label)}`);
  for (const d of dfg.nodes) {
    const flags = `${d.weak ? ' weak' : ''}${d.captured ? ' captured' : ''}`;
    const reads = uses.get(d.id);
    out.push(`${indent}${indent}${d.id} ${terminalSafe(d.name)} ${d.kind} L${d.line + 1}${flags}${reads ? ` → ${reads.join(' ')}` : ''}`);
  }
  for (const c of dfg.closures ?? []) {
    out.push(`${indent}closure ${terminalSafe(c.name)} L${c.line + 1}`);
    const inner: string[] = [];
    dfgLines(c, indent, inner, withSites);
    out.push(...inner.map(l => indent + l));
  }
}
