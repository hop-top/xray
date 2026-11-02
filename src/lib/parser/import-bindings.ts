import { isBuiltin } from 'module';
import Parser from 'tree-sitter';

/**
 * A name a file's imports put in scope, for deciding what a call on it can
 * reach. Data only; consumed through CallShape.bindings.
 */
export interface ImportBinding {
  /** Local name (`path` in `import * as path`, `h` in `use a::helper as h`). */
  name: string;
  /** Exported name it stands for, when it differs (`helper` for `h`). */
  imported?: string;
  /** Names a module / namespace (`ns.f()` is a call into it), not a value. */
  module: boolean;
  /** Bound to a language stdlib module: calls on it can never reach a user definition. */
  external: boolean;
}

/**
 * JS/TS specifier kind: Node builtin (`path`, `node:fs`) -> external; relative /
 * absolute -> repo file; anything else (npm package, path alias, `#` subpath)
 * -> unknown, since a package may be a workspace sibling or another root of a
 * merged graph (resolved cross-root later), so its calls keep their usual form.
 */
function jsExternal(specifier: string): boolean | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return false;
  return isBuiltin(specifier) ? true : undefined;
}

function unquote(node: Parser.SyntaxNode | null): string | undefined {
  if (!node || node.type !== 'string') return undefined;
  return node.text.slice(1, -1);
}

/** `{ a, b: bb }` / named imports -> bindings. */
function pushNamed(out: ImportBinding[], local: string, imported: string, external: boolean) {
  out.push({ name: local, ...(imported !== local ? { imported } : {}), module: false, external });
}

/** `import ... from 'm'`, `import x = require('m')`, `const x = require('m')` at top level. */
export function jsImportBindings(root: Parser.SyntaxNode): ImportBinding[] {
  const out: ImportBinding[] = [];
  for (const stmt of root.namedChildren) {
    if (stmt.type === 'import_statement') {
      const clause = stmt.namedChildren.find(c => c.type === 'import_clause' || c.type === 'import_require_clause');
      const source = unquote(stmt.childForFieldName('source') ?? clause?.childForFieldName('source') ?? null);
      const external = source === undefined ? undefined : jsExternal(source);
      if (!clause || external === undefined) continue;
      for (const part of clause.namedChildren) {
        if (part.type === 'identifier') {
          // Default import, or the name of `import x = require(...)`.
          out.push({ name: part.text, module: true, external });
        } else if (part.type === 'namespace_import') {
          const id = part.namedChildren.find(c => c.type === 'identifier');
          if (id) out.push({ name: id.text, module: true, external });
        } else if (part.type === 'named_imports') {
          for (const spec of part.namedChildren) {
            if (spec.type !== 'import_specifier') continue;
            const name = spec.childForFieldName('name')?.text;
            const alias = spec.childForFieldName('alias')?.text;
            if (name) pushNamed(out, alias ?? name, name, external);
          }
        }
      }
    } else if (stmt.type === 'lexical_declaration' || stmt.type === 'variable_declaration') {
      for (const decl of stmt.namedChildren) {
        if (decl.type !== 'variable_declarator') continue;
        const value = decl.childForFieldName('value');
        if (value?.type !== 'call_expression' || value.childForFieldName('function')?.text !== 'require') continue;
        const args = value.childForFieldName('arguments');
        const source = args?.namedChildCount === 1 ? unquote(args.firstNamedChild) : undefined;
        const external = source === undefined ? undefined : jsExternal(source);
        const target = decl.childForFieldName('name');
        if (external === undefined || !target) continue;
        if (target.type === 'identifier') {
          out.push({ name: target.text, module: true, external });
        } else if (target.type === 'object_pattern') {
          for (const p of target.namedChildren) {
            if (p.type === 'shorthand_property_identifier_pattern') pushNamed(out, p.text, p.text, external);
            else if (p.type === 'pair_pattern') {
              const key = p.childForFieldName('key')?.text;
              const val = p.childForFieldName('value');
              if (key && val?.type === 'identifier') pushNamed(out, val.text, key, external);
            }
          }
        }
      }
    }
  }
  return out;
}

const RUST_STD = new Set(['std', 'core', 'alloc']);

/** `use` path segments; a leading `::` (extern-crate path) yields an empty first segment. */
function segments(node: Parser.SyntaxNode): string[] {
  return node.text.replace(/\s+/g, '').split('::');
}

/**
 * Bindings of every `use` declaration: the last segment or alias of each path.
 * External only when the path starts at std/core/alloc (`::std` included);
 * other crates may be workspace members or another root of a merged graph.
 */
export function rustImportBindings(root: Parser.SyntaxNode): ImportBinding[] {
  const out: ImportBinding[] = [];
  const push = (name: string, path: string[], imported?: string) => out.push({
    name,
    ...(imported && imported !== name ? { imported } : {}),
    module: false,
    external: RUST_STD.has(path.find(seg => seg !== '') ?? ''),
  });
  const walk = (node: Parser.SyntaxNode, prefix: string[]) => {
    switch (node.type) {
      case 'identifier':
      case 'scoped_identifier': {
        const path = [...prefix, ...segments(node)];
        push(path[path.length - 1], path);
        return;
      }
      case 'self': // `{self, ..}` binds the list's own path.
        if (prefix.length > 0) push(prefix[prefix.length - 1], prefix);
        return;
      case 'use_as_clause': {
        const p = node.childForFieldName('path');
        const alias = node.childForFieldName('alias')?.text;
        if (!p || !alias) return;
        const path = [...prefix, ...segments(p)];
        push(alias, path, path[path.length - 1]);
        return;
      }
      case 'scoped_use_list': {
        const p = node.childForFieldName('path');
        const list = node.childForFieldName('list');
        if (list) walk(list, p ? [...prefix, ...segments(p)] : prefix);
        return;
      }
      case 'use_list':
        for (const c of node.namedChildren) walk(c, prefix);
        return;
      default: // use_wildcard, crate, super, ...: no single name bound.
        return;
    }
  };
  for (const use of root.descendantsOfType('use_declaration')) {
    const arg = use.childForFieldName('argument');
    if (arg) walk(arg, []);
  }
  return out;
}
