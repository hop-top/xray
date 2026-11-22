import * as path from 'path';
import { UsageError } from '../error/types';
import { detectLanguage } from '../parser/linguist-map';
import { getPack, packForExtension } from '../parser/grammars';
import { compileMatchers, compileSymbolGlob } from '../path-match';

export type FilterField = 'file' | 'lang' | 'kind' | 'confidence' | 'community' | 'sym' | 'repo';

const VALID_FIELDS = new Set<string>([
  'file',
  'lang',
  'kind',
  'confidence',
  'community',
  'sym',
  'repo',
]);

const VALID_CONFIDENCE = new Set<string>(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

export type FilterNode =
  | { type: 'or'; left: FilterNode; right: FilterNode }
  | { type: 'and'; left: FilterNode; right: FilterNode }
  | { type: 'not'; operand: FilterNode }
  | { type: 'field'; field: FilterField; value: string; isRegex?: boolean }
  | { type: 'bare'; value: string };

export interface FilterableItem {
  file?: string;
  name?: string;
  label?: string;
  kind?: string;
  confidence?: string;
  community?: string | number;
  repo?: string;
  lang?: string;
  content?: string;
}

type Token =
  | { kind: 'lparen'; offset: number }
  | { kind: 'rparen'; offset: number }
  | { kind: 'minus'; offset: number }
  | { kind: 'or'; offset: number }
  | { kind: 'field'; field: FilterField; value: string; isRegex: boolean; offset: number }
  | { kind: 'bare'; value: string; offset: number }
  | { kind: 'eof'; offset: number };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  const readQuoted = (quote: string, startOffset: number): string => {
    i++; // skip opening quote
    let out = '';
    while (i < len) {
      const ch = input[i];
      if (ch === '\\' && i + 1 < len) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) {
        i++; // skip closing quote
        return out;
      }
      out += ch;
      i++;
    }
    throw new UsageError(`Unterminated string literal at offset ${startOffset}`);
  };

  const readRegex = (startOffset: number): string => {
    i++; // skip opening '/'
    let pattern = '';
    while (i < len) {
      const ch = input[i];
      if (ch === '\\' && i + 1 < len) {
        pattern += ch + input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '/') {
        i++; // skip closing '/'
        try {
          // Validate regex syntax eagerly
          new RegExp(pattern);
        } catch (err) {
          throw new UsageError(
            `Invalid regular expression /${pattern}/ at offset ${startOffset}: ${(err as Error).message}`
          );
        }
        return pattern;
      }
      pattern += ch;
      i++;
    }
    throw new UsageError(`Unterminated regular expression at offset ${startOffset}`);
  };

  const readUnquotedWord = (): string => {
    let word = '';
    while (i < len) {
      const ch = input[i];
      if (/\s/.test(ch) || ch === '(' || ch === ')') break;
      word += ch;
      i++;
    }
    return word;
  };

  while (i < len) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    const offset = i;
    const ch = input[i];

    if (ch === '(') {
      tokens.push({ kind: 'lparen', offset });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ kind: 'rparen', offset });
      i++;
      continue;
    }

    if (ch === '-') {
      tokens.push({ kind: 'minus', offset });
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const value = readQuoted(ch, offset);
      tokens.push({ kind: 'bare', value, offset });
      continue;
    }

    // Read word or field:value
    let raw = '';
    while (i < len) {
      const c = input[i];
      if (/\s/.test(c) || c === '(' || c === ')' || c === ':') break;
      raw += c;
      i++;
    }

    if (i < len && input[i] === ':') {
      const fieldName = raw;
      if (!fieldName) {
        throw new UsageError(`Unexpected ':' at offset ${offset}`);
      }
      if (!VALID_FIELDS.has(fieldName)) {
        throw new UsageError(`Unknown field '${fieldName}:' at offset ${offset}`);
      }
      const field = fieldName as FilterField;
      i++; // consume ':'

      if (i >= len || /\s/.test(input[i]) || input[i] === ')') {
        throw new UsageError(`Missing value for field '${field}:' at offset ${offset}`);
      }

      let value = '';
      let isRegex = false;

      if (input[i] === '"' || input[i] === "'") {
        value = readQuoted(input[i], i);
      } else if (input[i] === '/') {
        value = readRegex(i);
        isRegex = true;
      } else {
        value = readUnquotedWord();
      }

      if (field === 'confidence') {
        const upper = value.toUpperCase();
        if (!VALID_CONFIDENCE.has(upper)) {
          throw new UsageError(
            `Invalid confidence '${value}' at offset ${offset} (expected EXTRACTED, INFERRED, or AMBIGUOUS)`
          );
        }
        value = upper;
      }

      tokens.push({ kind: 'field', field, value, isRegex, offset });
      continue;
    }

    if (raw === 'OR') {
      tokens.push({ kind: 'or', offset });
    } else {
      tokens.push({ kind: 'bare', value: raw, offset });
    }
  }

  tokens.push({ kind: 'eof', offset: len });
  return tokens;
}

class FilterParser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  parse(): FilterNode {
    if (this.peek().kind === 'eof') {
      throw new UsageError('Empty filter expression at offset 0');
    }
    const expr = this.parseOr();
    const next = this.peek();
    if (next.kind !== 'eof') {
      throw new UsageError(`Unexpected token '${next.kind === 'rparen' ? ')' : next.kind}' at offset ${next.offset}`);
    }
    return expr;
  }

  private parseOr(): FilterNode {
    let left = this.parseAnd();
    while (this.peek().kind === 'or') {
      const orTok = this.consume();
      if (this.peek().kind === 'eof' || this.peek().kind === 'rparen') {
        throw new UsageError(`Expected expression after 'OR' at offset ${orTok.offset}`);
      }
      const right = this.parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): FilterNode {
    let left = this.parseUnary();
    while (this.startsUnary(this.peek())) {
      const right = this.parseUnary();
      left = { type: 'and', left, right };
    }
    return left;
  }

  private startsUnary(tok: Token): boolean {
    return (
      tok.kind === 'minus' ||
      tok.kind === 'lparen' ||
      tok.kind === 'field' ||
      tok.kind === 'bare'
    );
  }

  private parseUnary(): FilterNode {
    const tok = this.peek();

    if (tok.kind === 'minus') {
      this.consume();
      if (!this.startsUnary(this.peek())) {
        throw new UsageError(`Expected expression after '-' at offset ${tok.offset}`);
      }
      return { type: 'not', operand: this.parseUnary() };
    }

    if (tok.kind === 'lparen') {
      this.consume();
      if (this.peek().kind === 'rparen') {
        throw new UsageError(`Empty parentheses at offset ${this.peek().offset}`);
      }
      const inner = this.parseOr();
      const close = this.peek();
      if (close.kind !== 'rparen') {
        throw new UsageError(`Unclosed '(' opened at offset ${tok.offset} (expected ')' at offset ${close.offset})`);
      }
      this.consume();
      return inner;
    }

    if (tok.kind === 'field') {
      this.consume();
      return { type: 'field', field: tok.field, value: tok.value, isRegex: tok.isRegex };
    }

    if (tok.kind === 'bare') {
      this.consume();
      return { type: 'bare', value: tok.value };
    }

    throw new UsageError(`Unexpected token '${tok.kind === 'rparen' ? ')' : tok.kind}' at offset ${tok.offset}`);
  }
}

/**
 * Parse a boolean filter DSL string into an AST.
 * Throws UsageError with character offset on malformed syntax or unknown fields.
 */
export function parseFilterDsl(input: string): FilterNode {
  const tokens = tokenize(input);
  return new FilterParser(tokens).parse();
}

function detectFileLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const pack = ext ? packForExtension(ext) : undefined;
  if (pack) return pack.name;
  return detectLanguage(filePath);
}

function matchFileField(file: string, value: string, isRegex?: boolean): boolean {
  const normalized = file.replace(/\\/g, '/');
  if (isRegex) {
    return new RegExp(value).test(normalized);
  }
  if (value.includes('*') || value.includes('?')) {
    const matcher = compileMatchers([value]);
    return matcher(normalized);
  }
  return normalized.toLowerCase().includes(value.toLowerCase());
}

function matchSymbolField(sym: string, value: string, isRegex?: boolean): boolean {
  if (isRegex) {
    return new RegExp(value).test(sym);
  }
  if (value.includes('*') || value.includes('?')) {
    return compileSymbolGlob(value)(sym);
  }
  return sym === value;
}

/**
 * Evaluate a parsed filter AST against a candidate item (file, search match, or graph node).
 */
export function evaluateFilter(ast: FilterNode, item: FilterableItem): boolean {
  switch (ast.type) {
    case 'or':
      return evaluateFilter(ast.left, item) || evaluateFilter(ast.right, item);
    case 'and':
      return evaluateFilter(ast.left, item) && evaluateFilter(ast.right, item);
    case 'not':
      return !evaluateFilter(ast.operand, item);
    case 'bare': {
      const needle = ast.value.toLowerCase();
      const haystack = [item.name, item.label, item.file, item.kind, item.content];
      return haystack.some((s) => typeof s === 'string' && s.toLowerCase().includes(needle));
    }
    case 'field': {
      switch (ast.field) {
        case 'file':
          return typeof item.file === 'string' && matchFileField(item.file, ast.value, ast.isRegex);
        case 'lang': {
          const itemLang = item.lang ?? (item.file ? detectFileLanguage(item.file) : null);
          if (!itemLang) return false;
          const targetLang = getPack(ast.value)?.name ?? ast.value.toLowerCase();
          return itemLang.toLowerCase() === targetLang;
        }
        case 'kind':
          return typeof item.kind === 'string' && item.kind.toLowerCase() === ast.value.toLowerCase();
        case 'confidence':
          return typeof item.confidence === 'string' && item.confidence.toUpperCase() === ast.value.toUpperCase();
        case 'community':
          return item.community !== undefined && String(item.community) === ast.value;
        case 'sym': {
          const sym = item.name ?? item.label;
          return typeof sym === 'string' && matchSymbolField(sym, ast.value, ast.isRegex);
        }
        case 'repo':
          return typeof item.repo === 'string' && item.repo.toLowerCase() === ast.value.toLowerCase();
      }
    }
  }
}
