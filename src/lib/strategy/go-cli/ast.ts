// Source-level command extraction for Go CLIs (cobra + urfave/cli) using
// tree-sitter-go. Used when no toolspec is available.
//
// Two stages:
//   1. extractFile(): purely syntactic, per file. Finds command literals
//      (&cobra.Command{...}, cli.Command{...}, cli.App{...}), flag definitions,
//      AddCommand wiring and the identifiers/functions each literal is bound to.
//   2. buildReport(): project-wide linking of those facts into a command tree.
//
// tree-sitter-go is optional at runtime (language packs): loadGoGrammar()
// returns null when it is absent and callers degrade gracefully.
import * as path from 'path';
import { CliCommand, CliFlag, CommandsReport, normalizeReport } from './model';

// ---------------------------------------------------------------- grammar --

export interface GoParserHandle {
  parse(src: string): any;
}

export type GrammarLoader = () => GoParserHandle | null;

/**
 * Lazily resolve tree-sitter + the go grammar through xray's language registry
 * (optional language packs). Null when the pack is not installed; not cached
 * here so installing it mid-process is picked up (the registry caches).
 */
let memo: { grammar: any; handle: GoParserHandle } | undefined;

export const loadGoGrammar: GrammarLoader = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getGrammar } = require('../../parser/grammars');
    const status = getGrammar('go');
    if (!status.ok) return null;
    if (memo && memo.grammar === status.grammar) return memo.handle;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Parser = require('tree-sitter');
    const parser = new Parser();
    parser.setLanguage(status.grammar);
    const handle = { parse: (src: string) => parser.parse(src, undefined, { bufferSize: Math.max(32768, src.length * 2) }) };
    memo = { grammar: status.grammar, handle };
    return handle;
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------ types --

export type Framework = 'cobra' | 'urfave';

export interface Ref {
  /** Direct reference to an extracted command. */
  id?: string;
  /** Identifier/function name to resolve at link time. */
  name?: string;
  qualifier?: string;
  call?: boolean;
  scope?: string;
}

export interface RawCmd {
  id: string;
  framework: Framework;
  isApp?: boolean;
  file: string;
  line: number;
  name?: string;
  short?: string;
  long?: string;
  aliases?: string[];
  hidden?: boolean;
  deprecated?: boolean;
  flags: CliFlag[];
  children: Ref[];
  /** Variable/function names bound to this literal (for fallback naming). */
  boundNames: string[];
}

export interface FileDefs {
  file: string;
  dir: string;
  pkg: string;
  imports: Record<string, string>;
  cmds: RawCmd[];
  bindings: Array<{ scope: string; name: string; to: Ref }>;
  returns: Array<{ func: string; to: Ref }>;
  adds: Array<{ parent: Ref; child: Ref }>;
  flagAttach: Array<{ target: Ref; flag: CliFlag }>;
  consts: Record<string, string>;
  /** kit cli.Config{Name: ...} values (root command is created inside kit). */
  toolNames: string[];
}

// ------------------------------------------------------------ small utils --

const FLAG_TYPES = [
  'String', 'Bool', 'Int', 'Int8', 'Int16', 'Int32', 'Int64', 'Uint', 'Uint8', 'Uint16', 'Uint32', 'Uint64',
  'Float32', 'Float64', 'Duration', 'Count', 'StringSlice', 'StringArray', 'StringToString', 'StringToInt',
  'StringToInt64', 'IntSlice', 'Int32Slice', 'Int64Slice', 'UintSlice', 'Float32Slice', 'Float64Slice',
  'BoolSlice', 'DurationSlice', 'IP', 'IPNet', 'IPMask', 'IPSlice', 'BytesHex', 'BytesBase64', 'Func',
  'BoolFunc', 'Var', 'TextVar',
];
const FLAG_METHOD = new RegExp(`^(${FLAG_TYPES.join('|')})(Var)?(P)?$`);

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function importAlias(importPath: string): string {
  const parts = importPath.split('/');
  let last = parts[parts.length - 1];
  if (/^v\d+$/.test(last) && parts.length > 1) last = parts[parts.length - 2];
  return last.replace(/-/g, '_');
}

function unquote(node: any): string | undefined {
  if (node.type === 'raw_string_literal') return node.text.slice(1, -1);
  if (node.type === 'interpreted_string_literal') {
    try {
      return JSON.parse(node.text);
    } catch {
      return node.text.slice(1, -1);
    }
  }
  return undefined;
}

// -------------------------------------------------------- const pre-pass --

/** Package-level string constants (and `var x = "..."`) in one file. */
export function collectConsts(root: any): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (n: any) => {
    if (n.type === 'const_spec' || n.type === 'var_spec') {
      const ids = n.namedChildren.filter((c: any) => c.type === 'identifier');
      const exprs = n.namedChildren.find((c: any) => c.type === 'expression_list');
      if (exprs) {
        exprs.namedChildren.forEach((e: any, i: number) => {
          const v = evalString(e, out);
          if (ids[i] && v !== undefined) out[ids[i].text] = v;
        });
      }
      return;
    }
    if (n.type === 'function_declaration' || n.type === 'method_declaration') return;
    for (const c of n.namedChildren) visit(c);
  };
  visit(root);
  return out;
}

function evalString(n: any, consts: Record<string, string>): string | undefined {
  const lit = unquote(n);
  if (lit !== undefined) return lit;
  if (n.type === 'identifier') return consts[n.text];
  if (n.type === 'parenthesized_expression') return evalString(n.namedChildren[0], consts);
  if (n.type === 'binary_expression' && n.children.some((c: any) => c.type === '+')) {
    const [l, r] = n.namedChildren;
    const a = evalString(l, consts);
    const b = evalString(r, consts);
    return a !== undefined && b !== undefined ? a + b : undefined;
  }
  return undefined;
}

// ------------------------------------------------------------ per-file ----

export function extractFile(
  rel: string,
  src: string,
  grammar: GoParserHandle,
  extraConsts: Record<string, string> = {}
): FileDefs {
  const tree = grammar.parse(src);
  const root = tree.rootNode;
  const defs: FileDefs = {
    file: rel,
    dir: path.posix.dirname(rel.split(path.sep).join('/')),
    pkg: '',
    imports: {},
    cmds: [],
    bindings: [],
    returns: [],
    adds: [],
    flagAttach: [],
    consts: {},
    toolNames: [],
  };
  defs.consts = { ...extraConsts, ...collectConsts(root) };
  const consts = defs.consts;

  for (const n of root.namedChildren) {
    if (n.type === 'package_clause') defs.pkg = n.namedChildren[0]?.text ?? '';
  }
  const collectImports = (n: any) => {
    if (n.type === 'import_spec') {
      const lit = n.namedChildren.find((c: any) => c.type === 'interpreted_string_literal' || c.type === 'raw_string_literal');
      const nameNode = n.namedChildren.find((c: any) => c.type === 'package_identifier' || c.type === 'blank_identifier' || c.type === 'dot');
      const p = lit ? unquote(lit) : undefined;
      if (p) defs.imports[nameNode ? nameNode.text : importAlias(p)] = p;
      return;
    }
    for (const c of n.namedChildren) if (n.type === 'source_file' || n.type.startsWith('import')) collectImports(c);
  };
  collectImports(root);

  const frameworkOf = (qualifier: string, typeName: string): Framework | null => {
    const p = defs.imports[qualifier] || '';
    if (p.includes('spf13/cobra') && typeName === 'Command') return 'cobra';
    if (p.includes('urfave/cli') && (typeName === 'Command' || typeName === 'App')) return 'urfave';
    return null;
  };

  const processed = new Map<number, string>();
  let seq = 0;
  const flagAliases = new Map<string, { target: Ref; persistent: boolean }>();

  const litBody = (n: any): any =>
    n.type === 'literal_value' ? n : n.childForFieldName?.('body') || n.namedChildren.find((c: any) => c.type === 'literal_value');

  const literalKind = (n: any): { fw: Framework; isApp: boolean; flagType?: string } | null => {
    if (n.type !== 'composite_literal') return null;
    const t = n.childForFieldName('type');
    if (!t || t.type !== 'qualified_type') return null;
    const q = t.namedChildren[0]?.text;
    const name = t.namedChildren[1]?.text;
    const fw = frameworkOf(q, name);
    if (fw) return { fw, isApp: name === 'App' };
    return null;
  };

  const unwrap = (n: any): any => {
    let cur = n;
    while (cur && (cur.type === 'unary_expression' || cur.type === 'parenthesized_expression')) {
      cur = cur.namedChildren[cur.namedChildren.length - 1];
    }
    return cur;
  };

  const keyedFields = (body: any): Array<{ key: string; value: any }> => {
    const out: Array<{ key: string; value: any }> = [];
    for (const el of body.namedChildren) {
      if (el.type !== 'keyed_element') continue;
      const [k, v] = el.namedChildren;
      const key = k?.namedChildren?.[0] ?? k;
      const val = v?.namedChildren?.[0] ?? v;
      if (key && val) out.push({ key: key.text, value: val });
    }
    return out;
  };

  const stringList = (n: any): string[] =>
    n.type === 'composite_literal'
      ? (litBody(n)?.namedChildren ?? [])
          .map((e: any) => evalString(e.namedChildren[0], consts))
          .filter((s: any): s is string => typeof s === 'string')
      : [];

  const isTrue = (n: any) => n.type === 'true';

  const refOf = (raw: any, scope: string): Ref | null => {
    const n = unwrap(raw);
    if (!n) return null;
    if (n.type === 'identifier') return { name: n.text, scope };
    if (n.type === 'selector_expression') {
      const op = n.childForFieldName('operand');
      const field = n.childForFieldName('field');
      if (op?.type === 'identifier' && field) return { name: field.text, qualifier: op.text, scope };
      return null;
    }
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'identifier') return { name: fn.text, call: true, scope };
      if (fn?.type === 'selector_expression') {
        const op = fn.childForFieldName('operand');
        const field = fn.childForFieldName('field');
        if (field) return { name: field.text, qualifier: op?.type === 'identifier' ? op.text : undefined, call: true, scope };
      }
      return null;
    }
    if (n.type === 'composite_literal') {
      const id = ensureCmd(n, scope);
      return id ? { id } : null;
    }
    return null;
  };

  const parseUrfaveFlag = (el: any): CliFlag | null => {
    const lit = unwrap(el);
    if (!lit || lit.type !== 'composite_literal') return null;
    const t = lit.childForFieldName('type');
    if (!t || t.type !== 'qualified_type') return null;
    const tn = t.namedChildren[1]?.text ?? '';
    if (!frameworkOf(t.namedChildren[0]?.text, 'Command') || !tn.endsWith('Flag')) return null;
    const body = litBody(lit);
    if (!body) return null;
    const flag: CliFlag = { name: '', type: lowerFirst(tn.slice(0, -4)) };
    for (const { key, value } of keyedFields(body)) {
      if (key === 'Name') flag.name = evalString(value, consts) ?? '';
      else if (key === 'Usage') flag.description = evalString(value, consts);
      else if (key === 'Aliases') {
        const short = stringList(value).find(a => a.length === 1);
        if (short) flag.shorthand = short;
      } else if (key === 'Value') {
        const v = evalString(value, consts) ?? (['int_literal', 'float_literal', 'true', 'false'].includes(value.type) ? value.text : undefined);
        if (v && v !== 'false' && v !== '0') flag.default = v;
      }
    }
    return flag.name ? flag : null;
  };

  function ensureCmd(node: any, scope: string, hint?: { fw: Framework; isApp: boolean }): string | null {
    if (processed.has(node.id)) return processed.get(node.id)!;
    const kind = literalKind(node) || hint;
    if (!kind) return null;
    const body = litBody(node);
    if (!body) return null;
    const id = `${rel}#${seq++}`;
    processed.set(node.id, id);
    const cmd: RawCmd = {
      id,
      framework: kind.fw,
      isApp: kind.isApp,
      file: rel,
      line: node.startPosition.row + 1,
      flags: [],
      children: [],
      boundNames: [],
    };
    defs.cmds.push(cmd);
    for (const { key, value } of keyedFields(body)) {
      if (kind.fw === 'cobra') {
        if (key === 'Use') {
          const use = evalString(value, consts);
          if (use) cmd.name = use.trim().split(/\s+/)[0];
        } else if (key === 'Short') cmd.short = evalString(value, consts);
        else if (key === 'Long') cmd.long = evalString(value, consts);
        else if (key === 'Aliases') cmd.aliases = stringList(value);
        else if (key === 'Hidden') cmd.hidden = isTrue(value) || undefined;
        else if (key === 'Deprecated') cmd.deprecated = !!evalString(value, consts) || undefined;
      } else {
        if (key === 'Name') cmd.name = evalString(value, consts);
        else if (key === 'Usage') cmd.short = evalString(value, consts);
        else if (key === 'Description' || key === 'UsageText') cmd.long = cmd.long ?? evalString(value, consts);
        else if (key === 'Aliases') cmd.aliases = stringList(value);
        else if (key === 'Hidden') cmd.hidden = isTrue(value) || undefined;
        else if (key === 'Commands' || key === 'Subcommands') {
          const lit = unwrap(value);
          if (lit?.type === 'composite_literal') {
            for (const el of litBody(lit)?.namedChildren ?? []) {
              const inner = el.namedChildren[0];
              if (!inner) continue;
              if (inner.type === 'literal_value') {
                const cid = ensureCmd(inner, scope, { fw: 'urfave', isApp: false });
                if (cid) cmd.children.push({ id: cid });
              } else {
                const r = refOf(inner, scope);
                if (r) cmd.children.push(r);
              }
            }
          }
        } else if (key === 'Flags') {
          const lit = unwrap(value);
          if (lit?.type === 'composite_literal') {
            for (const el of litBody(lit)?.namedChildren ?? []) {
              const f = parseUrfaveFlag(el.namedChildren[0]);
              if (f) cmd.flags.push(f);
            }
          }
        }
      }
    }
    return id;
  }

  /** Flag receiver: X.Flags() / X.PersistentFlags() / alias variable. */
  const flagReceiver = (operand: any, scope: string): { target: Ref; persistent: boolean } | null => {
    if (operand.type === 'identifier') return flagAliases.get(`${scope}#${operand.text}`) ?? null;
    if (operand.type === 'call_expression') {
      const fn = operand.childForFieldName('function');
      if (fn?.type !== 'selector_expression') return null;
      const m = fn.childForFieldName('field')?.text;
      if (m !== 'Flags' && m !== 'PersistentFlags') return null;
      const target = refOf(fn.childForFieldName('operand'), scope);
      return target ? { target, persistent: m === 'PersistentFlags' } : null;
    }
    return null;
  };

  const parseFlagCall = (method: string, args: any[]): CliFlag | null => {
    const m = FLAG_METHOD.exec(method);
    if (!m) return null;
    const [, base, isVar, isP] = m;
    const cobraVarOnly = base === 'Var' || base === 'TextVar'; // (value, name, [short,] usage)
    const count = base === 'Count';
    const fn = base === 'Func' || base === 'BoolFunc'; // (name, [short,] usage, fn)
    let i = isVar || cobraVarOnly ? 1 : 0;
    const name = args[i++];
    const short = isP ? args[i++] : undefined;
    let def: any;
    let usage: any;
    if (count) usage = args[i];
    else if (fn) usage = args[i];
    else if (cobraVarOnly) usage = args[i];
    else {
      def = args[i++];
      usage = args[i];
    }
    const nameStr = name && evalString(name, consts);
    if (!nameStr) return null;
    const flag: CliFlag = { name: nameStr, type: lowerFirst(base === 'Var' ? 'value' : base) };
    const s = short && evalString(short, consts);
    if (s) flag.shorthand = s;
    const u = usage && evalString(usage, consts);
    if (u) flag.description = u;
    if (def) {
      const dv = evalString(def, consts) ?? (['int_literal', 'float_literal', 'true'].includes(def.type) ? def.text : undefined);
      if (dv && dv !== '0') flag.default = dv;
    }
    return flag;
  };

  const handleCall = (n: any, scope: string) => {
    const fn = n.childForFieldName('function');
    if (!fn || fn.type !== 'selector_expression') return;
    const method = fn.childForFieldName('field')?.text ?? '';
    const operand = fn.childForFieldName('operand');
    const args = n.childForFieldName('arguments')?.namedChildren ?? [];
    if (method === 'AddCommand' && operand) {
      const parent = refOf(operand, scope);
      if (!parent) return;
      for (const a of args) {
        const child = refOf(a, scope);
        if (child) defs.adds.push({ parent, child });
      }
      return;
    }
    if (FLAG_METHOD.test(method) && operand) {
      const recv = flagReceiver(operand, scope);
      if (!recv) return;
      const flag = parseFlagCall(method, args);
      if (flag) defs.flagAttach.push({ target: recv.target, flag: { ...flag, persistent: recv.persistent || undefined } });
    }
  };

  const bind = (names: any[], values: any[], scope: string) => {
    names.forEach((nm, i) => {
      const v = values[i];
      if (!v || nm.type !== 'identifier') return;
      const u = unwrap(v);
      if (u.type === 'call_expression') {
        // flag alias: f := cmd.Flags()
        const recv = flagReceiver(u, scope);
        if (recv) {
          flagAliases.set(`${scope}#${nm.text}`, recv);
          return;
        }
      }
      const r = refOf(u, scope);
      if (r) {
        defs.bindings.push({ scope, name: nm.text, to: r });
        if (r.id) defs.cmds.find(c => c.id === r.id)?.boundNames.push(nm.text);
      }
    });
  };

  const visit = (n: any, scope: string) => {
    switch (n.type) {
      case 'function_declaration':
      case 'method_declaration': {
        const nm = n.childForFieldName('name')?.text ?? '';
        for (const c of n.namedChildren) visit(c, nm);
        return;
      }
      case 'var_spec': {
        const ids = n.namedChildren.filter((c: any) => c.type === 'identifier');
        const exprs = n.namedChildren.find((c: any) => c.type === 'expression_list');
        if (exprs) bind(ids, exprs.namedChildren, scope);
        break;
      }
      case 'short_var_declaration':
      case 'assignment_statement': {
        const l = n.childForFieldName('left');
        const r = n.childForFieldName('right');
        if (l && r) bind(l.namedChildren, r.namedChildren, scope);
        break;
      }
      case 'return_statement': {
        const first = n.namedChildren[0]?.namedChildren?.[0];
        if (first && scope) {
          const r = refOf(first, scope);
          if (r) {
            defs.returns.push({ func: scope, to: r });
            if (r.id) defs.cmds.find(c => c.id === r.id)?.boundNames.push(scope);
          }
        }
        break;
      }
      case 'call_expression':
        handleCall(n, scope);
        break;
      case 'composite_literal': {
        ensureCmd(n, scope);
        const t = n.childForFieldName('type');
        if (t?.type === 'qualified_type' && t.namedChildren[1]?.text === 'Config') {
          const imp = defs.imports[t.namedChildren[0]?.text] || '';
          const body = litBody(n);
          if (imp.includes('hop.top/kit') && body) {
            for (const { key, value } of keyedFields(body)) {
              const nm = key === 'Name' ? evalString(value, consts) : undefined;
              if (nm) defs.toolNames.push(nm);
            }
          }
        }
        break;
      }
    }
    for (const c of n.namedChildren) visit(c, scope);
  };
  visit(root, '');
  return defs;
}

// ------------------------------------------------------------ linking -----

export function buildReport(allDefs: FileDefs[], fallbackTool: string): CommandsReport {
  const warnings: string[] = [];
  const cmds = new Map<string, RawCmd>();
  type Owned = { to: Ref; owner: FileDefs };
  const pkgBind = new Map<string, Owned>(); // dir#name
  const localBind = new Map<string, Owned>(); // dir#scope#name#file
  const funcRet = new Map<string, Owned[]>(); // dir#func
  const dirs = new Set<string>();
  const importsByFile = new Map<string, Record<string, string>>();
  const fileInfo = new Map<string, FileDefs>();
  for (const d of allDefs) {
    dirs.add(d.dir);
    fileInfo.set(d.file, d);
    for (const c of d.cmds) cmds.set(c.id, c);
    for (const b of d.bindings) {
      if (b.scope === '') pkgBind.set(`${d.dir}#${b.name}`, { to: b.to, owner: d });
      else localBind.set(`${d.dir}#${b.scope}#${b.name}#${d.file}`, { to: b.to, owner: d });
    }
    for (const r of d.returns) {
      const k = `${d.dir}#${r.func}`;
      funcRet.set(k, [...(funcRet.get(k) ?? []), { to: r.to, owner: d }]);
    }
    importsByFile.set(d.file, d.imports);
  }

  const dirsMatching = (d: FileDefs, qualifier: string): string[] => {
    const imp = d.imports[qualifier];
    const key = imp ? imp.split('/').filter(p => !/^v\d+$/.test(p)).pop() : qualifier;
    return [...dirs].filter(x => path.posix.basename(x) === key);
  };

  // Name index for the project-wide unique-name fallback.
  const dirsByName = new Map<string, Set<string>>();
  const indexName = (k: string) => {
    const i = k.indexOf('#');
    const dir = k.slice(0, i);
    const name = k.slice(i + 1);
    dirsByName.set(name, (dirsByName.get(name) ?? new Set()).add(dir));
  };
  for (const k of pkgBind.keys()) indexName(k);
  for (const k of funcRet.keys()) indexName(k);

  const memo = new Map<string, string | null>();
  const resolve = (ref: Ref, d: FileDefs, depth = 0, seen = new Set<string>()): string | null => {
    if (ref.id) return ref.id;
    if (!ref.name) return null;
    const mk = `${d.file}|${ref.scope ?? ''}|${ref.qualifier ?? ''}|${ref.call ? 'c' : 'v'}|${ref.name}`;
    if (depth === 0 && memo.has(mk)) return memo.get(mk)!;
    const res = resolveUncached(ref, d, depth, seen);
    if (depth === 0) memo.set(mk, res);
    return res;
  };
  const resolveUncached = (ref: Ref, d: FileDefs, depth: number, seen: Set<string>): string | null => {
    if (depth > 12) return null;
    if (!ref.name) return null;
    const hop = (to: Ref, owner: FileDefs) => resolve(to, owner, depth + 1, seen);
    const searchDirs = ref.qualifier ? dirsMatching(d, ref.qualifier) : [d.dir];
    const tryDirs = (dirList: string[]): string | null => {
      for (const dir of dirList) {
        if (ref.call) {
          const ck = `call:${dir}#${ref.name}`;
          if (seen.has(ck)) continue;
          seen.add(ck);
          for (const r of funcRet.get(`${dir}#${ref.name}`) ?? []) {
            const got = hop(r.to, r.owner);
            if (got) return got;
          }
        } else {
          const key = `${dir}#${ref.name}`;
          const local = !ref.qualifier && ref.scope ? localBind.get(`${dir}#${ref.scope}#${ref.name}#${d.file}`) : undefined;
          const b = local ?? pkgBind.get(key);
          const sk = key + '/' + (ref.scope ?? '') + '/' + d.file;
          if (b && !seen.has(sk)) {
            seen.add(sk);
            const got = hop(b.to, b.owner);
            if (got) return got;
          }
        }
      }
      return null;
    };
    let got = tryDirs(searchDirs);
    if (got) return got;
    if (depth > 0) return null; // fallbacks below only at the top level
    if (ref.qualifier) {
      // method call on a receiver variable (a.cmd()) or unknown package alias
      got = tryDirs([d.dir]);
      if (got) return got;
    }
    // Unique-name fallback across the project.
    const hits: string[] = [];
    for (const dir of dirsByName.get(ref.name) ?? []) {
      const r = tryDirs([dir]);
      if (r && !hits.includes(r)) hits.push(r);
    }
    return hits.length === 1 ? hits[0] : null;
  };

  // kit creates the root cobra command internally (`var rootCmd = root.Cmd`),
  // so no literal exists for it. Anything wired to a root-looking reference
  // that does not resolve attaches to one synthetic root named after the
  // kit Config{Name: ...} (or the project).
  const toolName = allDefs.flatMap(x => x.toolNames)[0] ?? fallbackTool;
  const VROOT = 'virtual:root';
  let vrootUsed = false;
  const rootish = (ref: Ref, d: FileDefs, depth = 0): boolean => {
    if (depth > 4 || !ref.name) return false;
    if (ref.name === 'Cmd' && ref.qualifier) return true;
    if (!ref.qualifier && !ref.call && /^root/i.test(ref.name)) return true;
    if (ref.qualifier || ref.call) return false;
    const b = (ref.scope ? localBind.get(`${d.dir}#${ref.scope}#${ref.name}#${d.file}`) : undefined) ?? pkgBind.get(`${d.dir}#${ref.name}`);
    return !!b && rootish(b.to, b.owner, depth + 1);
  };
  const resolveOrRoot = (ref: Ref, d: FileDefs): string | null => {
    const id = resolve(ref, d);
    if (id) return id;
    if (rootish(ref, d)) {
      if (!vrootUsed) {
        vrootUsed = true;
        cmds.set(VROOT, {
          id: VROOT, framework: 'cobra', file: 'kit', line: 0, name: toolName, flags: [], children: [], boundNames: [],
        });
      }
      return VROOT;
    }
    return null;
  };

  // Parent edges.
  const parentOf = new Map<string, string>();
  const childOrder = new Map<string, string[]>();
  const link = (p: string, c: string) => {
    if (p === c || parentOf.has(c)) return;
    // cycle guard
    for (let cur: string | undefined = p; cur; cur = parentOf.get(cur)) if (cur === c) return;
    parentOf.set(c, p);
    childOrder.set(p, [...(childOrder.get(p) ?? []), c]);
  };
  for (const d of allDefs) {
    for (const c of d.cmds) {
      for (const ch of c.children) {
        const cid = resolve(ch, d);
        if (cid) link(c.id, cid);
      }
    }
    for (const a of d.adds) {
      const p = resolveOrRoot(a.parent, d);
      const c = resolve(a.child, d);
      if (p && c) link(p, c);
      else if (p && !c) warnings.push(`unresolved AddCommand child in ${d.file}`);
    }
    for (const fa of d.flagAttach) {
      const t = resolveOrRoot(fa.target, d);
      if (t) cmds.get(t)?.flags.push(fa.flag);
    }
  }

  // Names + paths.
  const nameOf = (c: RawCmd): string => {
    if (c.name) return c.name;
    const fb = c.boundNames[0];
    warnings.push(`command name unresolved at ${c.file}:${c.line}${fb ? ` (bound to ${fb})` : ''}`);
    return fb || 'unnamed';
  };
  const names = new Map<string, string>();
  for (const c of cmds.values()) names.set(c.id, nameOf(c));

  const descendants = (id: string): number =>
    (childOrder.get(id) ?? []).reduce((n, ch) => n + 1 + descendants(ch), 0);
  const roots = [...cmds.values()].filter(c => !parentOf.has(c.id));
  roots.sort((a, b) => descendants(b.id) - descendants(a.id) || a.file.localeCompare(b.file) || a.line - b.line);

  const out: CliCommand[] = [];
  const emit = (id: string, prefix: string[]) => {
    const c = cmds.get(id)!;
    const p = [...prefix, names.get(id)!];
    out.push({
      path: p,
      short: c.short || undefined,
      long: c.long || undefined,
      aliases: c.aliases && c.aliases.length ? c.aliases : undefined,
      flags: dedupeFlags(c.flags),
      hidden: c.hidden,
      deprecated: c.deprecated,
      file: id === VROOT ? undefined : c.file,
      line: id === VROOT ? undefined : c.line,
    });
    for (const ch of childOrder.get(id) ?? []) emit(ch, p);
  };
  roots.forEach((r, i) => {
    if (i > 0 && descendants(r.id) === 0 && r.framework === 'cobra') {
      warnings.push(`unattached command ${names.get(r.id)} (${r.file}:${r.line})`);
    }
    emit(r.id, []);
  });

  const tool = roots.length ? names.get(roots[0].id)! : toolName;
  return normalizeReport({ source: 'ast', tool, commands: out, warnings });
}

function dedupeFlags(flags: CliFlag[]): CliFlag[] {
  const seen = new Map<string, CliFlag>();
  for (const f of flags) if (!seen.has(f.name)) seen.set(f.name, f);
  return [...seen.values()];
}

// ----------------------------------------------------------- orchestrate --

export interface AstInput {
  /** Project-relative path -> Go source. */
  files: Array<{ rel: string; src: string }>;
  fallbackTool: string;
  loadGrammar?: GrammarLoader;
}

export interface AstOutcome {
  report?: CommandsReport;
  reason?: string;
}

export function extractCommandsAst(input: AstInput): AstOutcome {
  const grammar = (input.loadGrammar ?? loadGoGrammar)();
  if (!grammar) {
    return { reason: 'tree-sitter-go is not installed; AST extraction skipped' };
  }
  // Pre-pass: per-directory string constants so Use: someConst resolves across files.
  const parsed = input.files.map(f => ({ ...f, tree: grammar.parse(f.src) }));
  const constsByDir = new Map<string, Record<string, string>>();
  for (const f of parsed) {
    const dir = path.posix.dirname(f.rel.split(path.sep).join('/'));
    constsByDir.set(dir, { ...(constsByDir.get(dir) ?? {}), ...collectConsts(f.tree.rootNode) });
  }
  const all: FileDefs[] = [];
  const warnings: string[] = [];
  for (const f of input.files) {
    // Fast path: skip files that cannot define commands or flags.
    if (!/spf13\/cobra|urfave\/cli|hop\.top\/kit|AddCommand\(/.test(f.src)) continue;
    try {
      const dir = path.posix.dirname(f.rel.split(path.sep).join('/'));
      all.push(extractFile(f.rel, f.src, grammar, constsByDir.get(dir)));
    } catch (e: any) {
      warnings.push(`failed to parse ${f.rel}: ${e.message}`);
    }
  }
  const report = buildReport(all, input.fallbackTool);
  report.warnings.push(...warnings);
  return { report };
}
