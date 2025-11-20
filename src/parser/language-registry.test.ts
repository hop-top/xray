import { getLanguageConfig } from './language-registry';

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
});
