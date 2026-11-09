import { getLanguageConfig, updateLanguageQuery } from '../../src/lib/parser/language-registry';

describe('LanguageRegistry', () => {
    it('should return config for supported extensions', () => {
        expect(getLanguageConfig('.ts')).toBeDefined();
        expect(getLanguageConfig('.py')).toBeDefined();
    });

    it('should return undefined for unsupported extensions', () => {
        expect(getLanguageConfig('.xyz')).toBeUndefined();
    });

    it('should have grammar and tagsQuery', () => {
        const config = getLanguageConfig('.ts');
        expect(config?.grammar).toBeDefined();
        expect(typeof config?.tagsQuery).toBe('string');
    });

    describe('updateLanguageQuery', () => {
        // Snapshot/restore so tests are independent of order.
        let warnSpy: jest.SpyInstance;
        let originalGo: string;
        beforeEach(() => {
            warnSpy = jest.spyOn(console, 'warn').mockImplementation();
            originalGo = getLanguageConfig('.go')!.tagsQuery;
        });
        afterEach(() => {
            updateLanguageQuery('.go', originalGo);
            warnSpy.mockRestore();
        });

        it('accepts a valid tree-sitter query', () => {
            const valid = '(function_declaration name: (identifier) @name.definition.function)';
            updateLanguageQuery('.go', valid);
            expect(getLanguageConfig('.go')!.tagsQuery).toBe(valid);
        });

        it('rejects a Go source file disguised as a query (regression)', () => {
            const goSource = [
                'package main',
                '',
                'import "fmt"',
                '',
                'func main() {',
                '\temail := "user@example.com"',
                '\tfmt.Println(email)',
                '}',
            ].join('\n');
            updateLanguageQuery('.go', goSource);
            expect(getLanguageConfig('.go')!.tagsQuery).toBe(originalGo);
            expect(warnSpy).toHaveBeenCalled();
        });

        it('rejects empty content', () => {
            updateLanguageQuery('.go', '');
            expect(getLanguageConfig('.go')!.tagsQuery).toBe(originalGo);
        });

        it('warns for unknown extension', () => {
            updateLanguageQuery('.xyz', '(foo) @bar');
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown extension"));
        });
    });
});
