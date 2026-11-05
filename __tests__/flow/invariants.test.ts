import Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
import { buildFlow, flowTableFor } from '../../src/lib/flow';
import type { Cfg } from '../../src/lib/flow';

const TS = require('tree-sitter-typescript').typescript;
const table = flowTableFor('x.ts')!;
const SRC = path.join(__dirname, '../../src');

const files = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
};

/** Structural rules every CFG must satisfy, whatever the code. */
function violations(cfg: Cfg, where: string): string[] {
  const bad: string[] = [];
  const ids = new Set(cfg.nodes.map(n => n.id));
  const out = new Map<string, Cfg['edges']>();
  const inn = new Map<string, Cfg['edges']>();
  for (const e of cfg.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) bad.push(`${where}: dangling edge ${e.from}->${e.to}`);
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    inn.set(e.to, [...(inn.get(e.to) ?? []), e]);
  }
  const reach = (start: string, next: (id: string) => string[]): Set<string> => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) for (const t of next(stack.pop()!)) if (!seen.has(t)) { seen.add(t); stack.push(t); }
    return seen;
  };
  const fromEntry = reach('n0', id => (out.get(id) ?? []).map(e => e.to));
  const toExit = reach('n1', id => (inn.get(id) ?? []).map(e => e.from));
  for (const n of cfg.nodes) {
    const outs = out.get(n.id) ?? [];
    const normal = outs.filter(e => e.label !== 'throw');
    if (!fromEntry.has(n.id)) bad.push(`${where}: ${n.id} ${n.kind} unreachable from entry`);
    if (!toExit.has(n.id)) bad.push(`${where}: ${n.id} ${n.kind} cannot reach exit`);
    if (n.kind === 'exit' && outs.length) bad.push(`${where}: exit has successors`);
    if (n.kind === 'entry' && (inn.get(n.id) ?? []).length) bad.push(`${where}: entry has predecessors`);
    if (n.kind === 'rethrow' && (normal.length || outs.length !== 1)) bad.push(`${where}: rethrow must leave by one throw edge`);
    if (n.kind === 'throw' && normal.length) bad.push(`${where}: throw continues normally`);
    if (['return', 'break', 'continue'].includes(n.kind) && normal.length !== 1) bad.push(`${where}: ${n.kind} has ${normal.length} successors`);
    if (n.kind === 'cond' || n.kind === 'case' || (n.kind === 'loop' && !n.label.startsWith('for '))) {
      const labels = normal.map(e => e.label);
      if (!labels.includes('true') || !labels.includes('false')) bad.push(`${where}: ${n.kind} ${n.label} lacks a true/false pair`);
    }
  }
  for (const c of cfg.closures ?? []) bad.push(...violations(c, `${where}>${c.name}`));
  return bad;
};

describe('every function of this repo yields a well-formed graph', () => {
  it('reachable from entry, reaching exit, branches paired, jumps single-exit', () => {
    const parser = new Parser();
    parser.setLanguage(TS);
    let functions = 0;
    const bad: string[] = [];
    for (const file of files(SRC)) {
      const root = parser.parse(fs.readFileSync(file, 'utf8')).rootNode;
      const all: Parser.SyntaxNode[] = [];
      const visit = (n: Parser.SyntaxNode): void => {
        if (table.functions.includes(n.type) && n.childForFieldName('body')) { all.push(n); return; }
        for (const c of n.namedChildren) visit(c);
      };
      visit(root);
      for (const fn of all) {
        functions++;
        const { cfg, dfg } = buildFlow(fn, table, { cfg: true, dfg: true });
        bad.push(...violations(cfg!, `${path.relative(SRC, file)}:${fn.startPosition.row + 1}`));
        const defs = new Set(dfg!.nodes.map(d => d.id));
        const sites = new Set(cfg!.nodes.map(n => n.id));
        for (const e of dfg!.edges) if (!defs.has(e.from) || !sites.has(e.to)) bad.push(`dfg edge ${e.from}->${e.to} dangles`);
      }
    }
    expect(functions).toBeGreaterThan(500);
    expect(bad).toEqual([]);
  });
});
