import { parseFilterDsl, evaluateFilter, type FilterableItem } from '../src/lib/query/filter-dsl';
import { UsageError } from '../src/lib/error/types';

describe('Filter DSL', () => {
  describe('parsing & precedence', () => {
    it('parses a OR b c as a OR (b AND c)', () => {
      const ast = parseFilterDsl('a OR b c');
      expect(ast).toEqual({
        type: 'or',
        left: { type: 'bare', value: 'a' },
        right: {
          type: 'and',
          left: { type: 'bare', value: 'b' },
          right: { type: 'bare', value: 'c' },
        },
      });
    });

    it('parses negation over parenthesized OR expression: -(file:test OR lang:python)', () => {
      const ast = parseFilterDsl('-(file:test OR lang:python)');
      expect(ast).toEqual({
        type: 'not',
        operand: {
          type: 'or',
          left: { type: 'field', field: 'file', value: 'test', isRegex: false },
          right: { type: 'field', field: 'lang', value: 'python', isRegex: false },
        },
      });
    });

    it('supports double negation and grouped AND/OR', () => {
      const ast = parseFilterDsl('--kind:function (sym:foo OR sym:bar)');
      expect(ast.type).toBe('and');
    });

    it('supports quoted values and regex literals for file:', () => {
      const ast = parseFilterDsl('file:/^src\\/.*\\.ts$/ sym:"Foo::bar"');
      expect(ast).toEqual({
        type: 'and',
        left: { type: 'field', field: 'file', value: '^src\\/.*\\.ts$', isRegex: true },
        right: { type: 'field', field: 'sym', value: 'Foo::bar', isRegex: false },
      });
    });
  });

  describe('syntax errors throw UsageError with character offset', () => {
    it('throws UsageError on empty input', () => {
      expect(() => parseFilterDsl('')).toThrow(UsageError);
      expect(() => parseFilterDsl('   ')).toThrow(UsageError);
    });

    it('throws UsageError with offset on unclosed parenthesis', () => {
      try {
        parseFilterDsl('(file:src a');
        fail('Expected UsageError');
      } catch (err) {
        expect(err).toBeInstanceOf(UsageError);
        expect((err as Error).message).toMatch(/offset\s+0/i);
      }
    });

    it('throws UsageError with offset on unexpected closing parenthesis', () => {
      try {
        parseFilterDsl('file:src )');
        fail('Expected UsageError');
      } catch (err) {
        expect(err).toBeInstanceOf(UsageError);
        expect((err as Error).message).toMatch(/offset\s+9/i);
      }
    });

    it('throws UsageError with offset on empty parentheses', () => {
      try {
        parseFilterDsl('()');
        fail('Expected UsageError');
      } catch (err) {
        expect(err).toBeInstanceOf(UsageError);
        expect((err as Error).message).toMatch(/offset\s+1/i);
      }
    });

    it('throws UsageError with offset on unknown field', () => {
      try {
        parseFilterDsl('lang:ts unknown:val');
        fail('Expected UsageError');
      } catch (err) {
        expect(err).toBeInstanceOf(UsageError);
        expect((err as Error).message).toMatch(/unknown/i);
        expect((err as Error).message).toMatch(/offset\s+8/i);
      }
    });

    it('throws UsageError with offset on invalid confidence value', () => {
      try {
        parseFilterDsl('confidence:MAYBE');
        fail('Expected UsageError');
      } catch (err) {
        expect(err).toBeInstanceOf(UsageError);
        expect((err as Error).message).toMatch(/offset/i);
      }
    });

    it('throws UsageError with offset on dangling OR', () => {
      try {
        parseFilterDsl('a OR');
        fail('Expected UsageError');
      } catch (err) {
        expect(err).toBeInstanceOf(UsageError);
        expect((err as Error).message).toMatch(/offset/i);
      }
    });
  });

  describe('evaluation', () => {
    const tsFunc: FilterableItem = {
      file: 'src/auth/login.ts',
      name: 'authenticateUser',
      kind: 'function',
      confidence: 'EXTRACTED',
      community: 2,
      repo: 'xray',
    };

    const pyTest: FilterableItem = {
      file: 'tests/test_auth.py',
      name: 'test_login',
      kind: 'function',
      confidence: 'INFERRED',
      community: 5,
      repo: 'xray',
    };

    const zigFile: FilterableItem = {
      file: 'src/main.zig',
    };

    it('evaluates precedence a OR b c correctly', () => {
      const ast = parseFilterDsl('authenticateUser OR test_login kind:class');
      // tsFunc matches 'authenticateUser' -> true even though kind is not class
      expect(evaluateFilter(ast, tsFunc)).toBe(true);
      // pyTest matches 'test_login' but not 'kind:class' -> false
      expect(evaluateFilter(ast, pyTest)).toBe(false);
    });

    it('evaluates -(file:test OR lang:python)', () => {
      const ast = parseFilterDsl('-(file:test OR lang:python)');
      expect(evaluateFilter(ast, tsFunc)).toBe(true);
      expect(evaluateFilter(ast, pyTest)).toBe(false);
      expect(evaluateFilter(ast, { file: 'test/foo.ts' })).toBe(false);
    });

    it('evaluates lang: using primary and linguist-map languages', () => {
      expect(evaluateFilter(parseFilterDsl('lang:typescript'), tsFunc)).toBe(true);
      expect(evaluateFilter(parseFilterDsl('lang:ts'), tsFunc)).toBe(true);
      expect(evaluateFilter(parseFilterDsl('lang:python'), pyTest)).toBe(true);
      expect(evaluateFilter(parseFilterDsl('lang:zig'), zigFile)).toBe(true);
    });

    it('evaluates file: globs and regexes', () => {
      expect(evaluateFilter(parseFilterDsl('file:*.ts'), tsFunc)).toBe(true);
      expect(evaluateFilter(parseFilterDsl('file:src/**/*.ts'), tsFunc)).toBe(true);
      expect(evaluateFilter(parseFilterDsl('file:/^src\\/auth\\//'), tsFunc)).toBe(true);
      expect(evaluateFilter(parseFilterDsl('file:*.py'), tsFunc)).toBe(false);
    });

    it('evaluates kind:, confidence:, community:, sym:, repo:', () => {
      expect(evaluateFilter(parseFilterDsl('kind:function confidence:EXTRACTED community:2 sym:authenticateUser repo:xray'), tsFunc)).toBe(true);
      expect(evaluateFilter(parseFilterDsl('confidence:AMBIGUOUS'), tsFunc)).toBe(false);
      expect(evaluateFilter(parseFilterDsl('sym:auth*'), tsFunc)).toBe(true);
    });
  });
});
