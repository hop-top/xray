import type Parser from 'tree-sitter';
import * as fs from 'fs';
import * as path from 'path';
import { buildFlow, flowTableFor } from '../../src/lib/flow';
import type { Cfg } from '../../src/lib/flow';
import { parserFor, Lang } from './helpers';

const ROOT = path.join(__dirname, '../..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

const files = (dir: string, ok: (name: string) => boolean, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) files(p, ok, out); }
    else if (ok(e.name)) out.push(p);
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
    // An endless loop (`for {}`, `select {}`) never reaches exit: its nodes are trapped (all successors trapped too), and so is exit's reachability.
    const trapped = (id: string): boolean => !toExit.has(id) && (out.get(id) ?? []).length > 0 &&
      (out.get(id) ?? []).every(e => !toExit.has(e.to));
    const endless = toExit.size === 1 && !fromEntry.has('n1');
    if (!fromEntry.has(n.id) && !(endless && n.kind === 'exit')) bad.push(`${where}: ${n.id} ${n.kind} unreachable from entry`);
    if (!toExit.has(n.id) && !trapped(n.id)) bad.push(`${where}: ${n.id} ${n.kind} cannot reach exit`);
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


/** Where each language's real code comes from, and how many functions it must have. */
const CORPORA: Array<{ lang: Lang; ext: string; roots: string[]; ok: (n: string) => boolean; min: number }> = [
  { lang: 'ts', ext: '.ts', roots: ['src'], ok: n => n.endsWith('.ts') && !n.endsWith('.d.ts'), min: 500 },
  { lang: 'js', ext: '.js', roots: ['bin', 'jest.config.js', '__tests__'], ok: n => /\.(js|mjs|cjs|jsx)$/.test(n), min: 5 },
  { lang: 'py', ext: '.py', roots: ['__tests__/fixtures'], ok: n => n.endsWith('.py'), min: 15 },
  { lang: 'go', ext: '.go', roots: ['__tests__/fixtures'], ok: n => n.endsWith('.go'), min: 10 },


];

describe.each(CORPORA)('every function of the $lang corpus yields a well-formed graph', ({ lang, ext, roots, ok, min }) => {
  it('reachable from entry, reaching exit, branches paired, jumps single-exit', () => {
    const table = flowTableFor(`x${ext}`)!;
    const parser = parserFor(lang);
    let functions = 0;
    const bad: string[] = [];
    const list = roots.flatMap(r => {
      const abs = path.join(ROOT, r);
      return fs.statSync(abs).isDirectory() ? files(abs, ok) : [abs];
    });
    for (const file of list) {
      const root = parser.parse(fs.readFileSync(file, 'utf8')).rootNode;
      const all: Parser.SyntaxNode[] = [];
      const visit = (n: Parser.SyntaxNode): void => {
        if (table.functions.includes(n.type) && n.childForFieldName(table.fn.body)) { all.push(n); return; }
        for (const c of n.namedChildren) visit(c);
      };
      visit(root);
      for (const fn of all) {
        functions++;
        const { cfg, dfg } = buildFlow(fn, table, { cfg: true, dfg: true });
        const where = `${path.relative(ROOT, file)}:${fn.startPosition.row + 1}`;
        bad.push(...violations(cfg!, where));
        const defs = new Set(dfg!.nodes.map(d => d.id));
        const sites = new Set(cfg!.nodes.map(n => n.id));
        for (const e of dfg!.edges) if (!defs.has(e.from) || !sites.has(e.to)) bad.push(`dfg edge ${e.from}->${e.to} dangles`);
      }
    }
    expect(functions).toBeGreaterThanOrEqual(min);
    expect(bad).toEqual([]);
  });
});
