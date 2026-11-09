import { QueryResolver } from '../src/lib/query-resolver';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs
jest.mock('fs');

describe('QueryResolver', () => {
    const mockFs = fs as jest.Mocked<typeof fs>;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should resolve explicit mappings', () => {
        const input = ['.ts:./custom.scm', '.py:https://example.com/py.scm'];
        const result = QueryResolver.resolve(input);
        expect(result).toEqual({
            '.ts': './custom.scm',
            '.py': 'https://example.com/py.scm',
        });
    });

    test('should handle comma-separated lists', () => {
        const input = ['.ts:./custom.scm, .py:./py.scm'];
        const result = QueryResolver.resolve(input);
        expect(result).toEqual({
            '.ts': './custom.scm',
            '.py': './py.scm',
        });
    });

    test('should infer language from filename (file path)', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);

        const input = ['./path/to/python.scm'];
        const result = QueryResolver.resolve(input);
        expect(result).toEqual({
            '.py': './path/to/python.scm',
        });
    });

    test('should infer language from filename (URL)', () => {
        const input = ['https://example.com/queries/typescript.scm'];
        const result = QueryResolver.resolve(input);
        expect(result).toEqual({
            '.ts': 'https://example.com/queries/typescript.scm',
            '.tsx': 'https://example.com/queries/typescript.scm',
            '.mts': 'https://example.com/queries/typescript.scm',
            '.cts': 'https://example.com/queries/typescript.scm',
        });
    });

    test('should scan directory for known query files', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
        mockFs.readdirSync.mockReturnValue(['python.scm', 'go.scm', 'readme.md'] as any);

        const input = ['./queries-dir'];
        const result = QueryResolver.resolve(input);

        expect(result).toEqual({
            '.py': 'queries-dir/python.scm',
            '.go': 'queries-dir/go.scm',
        });
    });

    test('should handle mixed inputs', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockImplementation((p) => {
            if (p === './dir') return { isDirectory: () => true } as any;
            return { isDirectory: () => false } as any;
        });
        mockFs.readdirSync.mockReturnValue(['rust.scm'] as any);

        const input = ['.ts:explicit.scm', './dir', 'https://site.com/java.scm'];
        const result = QueryResolver.resolve(input);

        expect(result).toEqual({
            '.ts': 'explicit.scm',
            '.rs': 'dir/rust.scm',
            '.java': 'https://site.com/java.scm',
        });
    });

    test('should warn and skip unknown files', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);

        const input = ['./unknown.scm'];
        const result = QueryResolver.resolve(input);

        expect(result).toEqual({});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not infer language'));
    });

    test('should infer language from aliases (individual)', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);

        expect(QueryResolver.resolve(['py-tags.scm'])).toEqual({ '.py': 'py-tags.scm' });
        expect(QueryResolver.resolve(['whatever-js.scm'])).toEqual({ '.js': 'whatever-js.scm', '.jsx': 'whatever-js.scm', '.mjs': 'whatever-js.scm', '.cjs': 'whatever-js.scm' });
        expect(QueryResolver.resolve(['jsx-tags.scm'])).toEqual({ '.js': 'jsx-tags.scm', '.jsx': 'jsx-tags.scm', '.mjs': 'jsx-tags.scm', '.cjs': 'jsx-tags.scm' });
        expect(QueryResolver.resolve(['my-ts-query.scm'])).toEqual({ '.ts': 'my-ts-query.scm', '.tsx': 'my-ts-query.scm', '.mts': 'my-ts-query.scm', '.cts': 'my-ts-query.scm' });
        expect(QueryResolver.resolve(['rust_query.scm'])).toEqual({ '.rs': 'rust_query.scm' });
        expect(QueryResolver.resolve(['go.scm'])).toEqual({ '.go': 'go.scm' });
    });

    test('should reject non-.scm source files (regression: would crash tree-sitter)', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => false } as any);

        const input = ['/Users/me/code/printingpress/internal/generator/generator.go'];
        const result = QueryResolver.resolve(input);

        expect(result).toEqual({});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('must point to a .scm file'));
    });

    test('should reject non-.scm URLs', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

        const input = ['https://example.com/some/generator.go'];
        const result = QueryResolver.resolve(input);

        expect(result).toEqual({});
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('must point to a .scm file'));
    });

    test('explicit ext:path mapping bypasses .scm requirement', () => {
        const input = ['.go:/abs/path/custom-go-query'];
        const result = QueryResolver.resolve(input);
        expect(result).toEqual({ '.go': '/abs/path/custom-go-query' });
    });

    test('accepts a .scm URL with a query string', () => {
        const input = ['https://example.com/queries/typescript.scm?raw=1'];
        const result = QueryResolver.resolve(input);
        expect(result).toEqual({
            '.ts': 'https://example.com/queries/typescript.scm?raw=1',
            '.tsx': 'https://example.com/queries/typescript.scm?raw=1',
            '.mts': 'https://example.com/queries/typescript.scm?raw=1',
            '.cts': 'https://example.com/queries/typescript.scm?raw=1',
        });
    });

    test('directory scan accepts mixed-case .SCM filenames', () => {
        mockFs.existsSync.mockReturnValue(true);
        mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
        mockFs.readdirSync.mockReturnValue(['Python.SCM', 'go.scm', 'README.md'] as any);

        const result = QueryResolver.resolve(['./queries-dir']);
        expect(result).toEqual({
            '.py': 'queries-dir/Python.SCM',
            '.go': 'queries-dir/go.scm',
        });
    });
});
