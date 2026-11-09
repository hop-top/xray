import Parser from 'tree-sitter';
import { buildFlow, flowTableFor } from '../../src/lib/flow';
import type { Cfg, Dfg, FlowResult } from '../../src/lib/flow';

export type Lang = 'ts' | 'js' | 'py' | 'go';
const GRAMMAR: Record<Lang, () => any> = {
  ts: () => require('tree-sitter-typescript').typescript,
  js: () => require('tree-sitter-javascript'),
  py: () => require('tree-sitter-python'),
  go: () => require('tree-sitter-go'),
};
const parsers = new Map<Lang, Parser>();

export const parserFor = (lang: Lang): Parser => {
  let p = parsers.get(lang);
  if (!p) {
    p = new Parser();
    p.setLanguage(GRAMMAR[lang]());
    parsers.set(lang, p);
  }
  return p;
};

/** Function node called `name` in a parsed tree (declaration name, or the variable it is assigned to). */
function findFunction(root: Parser.SyntaxNode, name: string, lang: Lang): Parser.SyntaxNode {
  const table = flowTableFor(`x.${lang}`)!;
  const find = (n: Parser.SyntaxNode): Parser.SyntaxNode | null => {
    if (table.functions.includes(n.type)) {
      const nm = n.childForFieldName('name');
      const decl = n.parent && n.parent.type === 'variable_declarator' ? n.parent.childForFieldName('name')
        : n.parent && n.parent.type === 'assignment' ? n.parent.childForFieldName('left') : null;
      if ((nm && nm.text === name) || (decl && decl.text === name)) return n;
    }
    for (const c of n.namedChildren) {
      const r = find(c);
      if (r) return r;
    }
    return null;
  };
  const fn = find(root);
  if (!fn) throw new Error(`no function ${name}`);
  return fn;
}

/** Flow of the function called `name` in `code` (TypeScript unless `lang` says otherwise). */
export function flowOf(code: string, name = 'f', want = { cfg: true, dfg: true }, maxNodes?: number, lang: Lang = 'ts'): FlowResult {
  const tree = parserFor(lang).parse(code);
  return buildFlow(findFunction(tree.rootNode, name, lang), flowTableFor(`x.${lang}`)!, want, maxNodes);
}

/**
 * Name of every CFG node independent of ids: `<kind> <label>`; a name the
 * function has more than once (finally copies) gets ` <- <predecessors>`,
 * refined with the predecessors' own names until the names differ.
 */
export function cfgKeys(cfg: Cfg): Map<string, string> {
  const base = new Map(cfg.nodes.map(n => [n.id, `${n.kind} ${n.label}`]));
  let keys = new Map(base);
  for (let round = 0; round < 8; round++) {
    const count = new Map<string, number>();
    for (const k of keys.values()) count.set(k, (count.get(k) ?? 0) + 1);
    if ([...count.values()].every(c => c === 1)) break;
    const next = new Map(keys);
    for (const n of cfg.nodes) {
      if (count.get(keys.get(n.id)!) === 1) continue;
      const preds = cfg.edges.filter(e => e.to === n.id)
        .map(e => `${keys.get(e.from)}${e.label ? ` /${e.label}` : ''}`).sort();
      next.set(n.id, `${base.get(n.id)} <- ${preds.join(', ')}`);
    }
    keys = next;
  }
  return keys;
}

export function cfgShape(cfg: Cfg): { nodes: string[]; edges: string[] } {
  const keys = cfgKeys(cfg);
  return {
    nodes: [...keys.values()].sort(),
    edges: cfg.edges.map(e => `${keys.get(e.from)} -> ${keys.get(e.to)}${e.label ? ` [${e.label}]` : ''}`).sort(),
  };
}

/** Definitions as `name:kind@line` (+ flags) and def-use edges as `def -> <kind> <label>`. */
export function dfgShape(dfg: Dfg, cfg: Cfg): { defs: string[]; edges: string[] } {
  const keys = cfgKeys(cfg);
  const defKey = new Map(dfg.nodes.map(d =>
    [d.id, `${d.name}:${d.kind}@${d.line + 1}${d.weak ? ' weak' : ''}${d.captured ? ' captured' : ''}`]));
  return {
    defs: [...defKey.values()].sort(),
    edges: dfg.edges.map(e => `${defKey.get(e.from)} -> ${keys.get(e.to)}`).sort(),
  };
}

export const sorted = (a: string[]): string[] => [...a].sort();

/** Exact-graph assertions for one language (see cfg.test.ts for the idea). */
export const cfgCheck = (lang: Lang) => (code: string, nodes: string[], edges: string[], name = 'f'): void => {
  const shape = cfgShape(flowOf(code, name, { cfg: true, dfg: true }, undefined, lang).cfg!);
  expect(shape.nodes).toEqual(sorted(['entry entry', 'exit exit', ...nodes]));
  expect(shape.edges).toEqual(sorted(edges));
};

export const dfgCheck = (lang: Lang) => (code: string, defs: string[], edges: string[], name = 'f'): void => {
  const { cfg, dfg } = flowOf(code, name, { cfg: true, dfg: true }, undefined, lang);
  const shape = dfgShape(dfg!, cfg!);
  expect(shape.defs).toEqual(sorted(defs));
  expect(shape.edges).toEqual(sorted(edges));
};
