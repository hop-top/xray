import type { CfgEdge, Dfg, DfgDef, DfgEdge, DfgSite } from './types';
import type { FlowNode } from './cfg';
import { MAX_FLOW_DEFS, MAX_FLOW_EDGES } from './types';

/** Passes over the CFG before the fixpoint is given up (loops nest a handful deep; this is generous). */
const MAX_PASSES = 64;

/**
 * Def-use edges from reaching definitions over the CFG.
 *
 * A definition reaches a node when some path from it to the node does not
 * strongly redefine the same variable. Strong definitions (`=`, `let`,
 * `++`, parameters, destructuring) kill earlier ones; weak ones (`o.p = v`,
 * `x ||= v`) add themselves without killing. Edges leaving a node by a
 * `throw` label carry the state before the node ran (a throwing statement
 * does not complete its own definitions). The solution is the union over
 * all paths: loop-carried definitions reach the loop head, both branches'
 * definitions reach a join.
 */
export function computeDfg(nodes: FlowNode[], edges: CfgEdge[], captured: (bindingId: number) => boolean): Dfg {
  const defs: Array<DfgDef & { binding: number; nodeIndex: number }> = [];
  const index = new Map<string, number>();
  nodes.forEach((n, i) => index.set(n.id, i));
  const gen: number[][] = nodes.map(() => []);
  const kill: Array<Set<number>> = nodes.map(() => new Set());
  const byBinding = new Map<number, number[]>();

  let capped = false;
  nodes.forEach((n, i) => {
    const last = new Map<number, number>();
    for (const d of n.refs.defs) {
      if (defs.length >= MAX_FLOW_DEFS) { capped = true; break; }
      const id = defs.length;
      defs.push({
        id: `d${id}`, name: d.binding.name, kind: d.kind, line: d.line, at: n.id,
        binding: d.binding.id, nodeIndex: i,
        ...(d.weak ? { weak: true as const } : {}),
      });
      if (!byBinding.has(d.binding.id)) byBinding.set(d.binding.id, []);
      byBinding.get(d.binding.id)!.push(id);
      gen[i].push(id);
      if (!d.weak) last.set(d.binding.id, id);
    }
    // Several strong definitions of one variable in a node: only the last survives.
    gen[i] = gen[i].filter(id => defs[id].weak || last.get(defs[id].binding) === id);
    for (const b of last.keys()) kill[i].add(b);
  });

  const preds: Array<Array<{ from: number; throws: boolean }>> = nodes.map(() => []);
  for (const e of edges) {
    const f = index.get(e.from);
    const t = index.get(e.to);
    if (f !== undefined && t !== undefined) preds[t].push({ from: f, throws: e.label === 'throw' });
  }

  const inn: Array<Set<number>> = nodes.map(() => new Set());
  const out: Array<Set<number>> = nodes.map(() => new Set());
  const apply = (i: number): Set<number> => {
    const o = new Set<number>();
    for (const d of inn[i]) if (!kill[i].has(defs[d].binding)) o.add(d);
    for (const d of gen[i]) o.add(d);
    return o;
  };
  let changed = true;
  let passes = 0;
  while (changed) {
    if (++passes > MAX_PASSES) { capped = true; break; }
    changed = false;
    for (let i = 0; i < nodes.length; i++) {
      const next = new Set<number>();
      for (const p of preds[i]) for (const d of (p.throws ? inn[p.from] : out[p.from])) next.add(d);
      if (next.size !== inn[i].size || [...next].some(d => !inn[i].has(d))) {
        inn[i] = next;
        changed = true;
      }
      const o = apply(i);
      if (o.size !== out[i].size || [...o].some(d => !out[i].has(d))) {
        out[i] = o;
        changed = true;
      }
    }
  }

  const dfgEdges: DfgEdge[] = [];
  const sites = new Set<number>();
  nodes.forEach((n, i) => {
    // Entry reads its own parameters (defaults like `(a, b = a)`), bound left to right.
    const reaching = i === 0 ? out[0] : inn[i];
    if (n.refs.uses.length === 0 || reaching.size === 0) return;
    const byBinding = new Map<number, number[]>();
    for (const d of [...reaching].sort((x, y) => x - y)) {
      const list = byBinding.get(defs[d].binding);
      if (list) list.push(d); else byBinding.set(defs[d].binding, [d]);
    }
    for (const b of n.refs.uses) {
      for (const d of byBinding.get(b.id) ?? []) {
        if (dfgEdges.length >= MAX_FLOW_EDGES) { capped = true; return; }
        dfgEdges.push({ from: defs[d].id, to: n.id });
        sites.add(i);
      }
    }
  });

  const outDefs: DfgDef[] = defs.map(({ binding, nodeIndex, ...d }) =>
    captured(binding) ? { ...d, captured: true as const } : d);
  const siteList: DfgSite[] = [...sites].sort((a, b) => a - b)
    .map(i => ({ id: nodes[i].id, line: nodes[i].line, label: nodes[i].label }));
  const dfg: Dfg = { nodes: outDefs, edges: dfgEdges, sites: siteList };
  if (capped) dfg.truncated = { nodes: outDefs.length, limit: outDefs.length, partial: true };
  return dfg;
}
