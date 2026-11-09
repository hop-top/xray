// Guards jest.config.js path patterns against both npm (hoisted) and pnpm
// (.pnpm/<name>@<ver>/node_modules/<name>) layouts. Jest resolves symlinks to
// realpaths, so under pnpm the `.pnpm` segment is what the patterns see.
// commander >=15 is ESM-only and must be transformed in both layouts.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../jest.config.js') as {
    transform: Record<string, unknown>;
    transformIgnorePatterns: string[];
};

// Jest joins transformIgnorePatterns with '|' and tests the file path.
const ignored = (file: string): boolean =>
    new RegExp(config.transformIgnorePatterns.join('|')).test(file);

const transformed = (file: string): boolean =>
    Object.keys(config.transform).some((k) => new RegExp(k).test(file));

const NPM_COMMANDER = '/x/node_modules/commander/index.js';
const PNPM_COMMANDER = '/x/node_modules/.pnpm/commander@15.0.0/node_modules/commander/index.js';

describe('jest.config transformIgnorePatterns', () => {
    it('does not ignore commander under npm layout', () => {
        expect(ignored(NPM_COMMANDER)).toBe(false);
    });

    it('does not ignore commander under pnpm layout', () => {
        expect(ignored(PNPM_COMMANDER)).toBe(false);
    });

    it('ignores other packages under npm layout', () => {
        expect(ignored('/x/node_modules/lodash/index.js')).toBe(true);
    });

    it('ignores other packages under pnpm layout', () => {
        expect(ignored('/x/node_modules/.pnpm/lodash@4/node_modules/lodash/index.js')).toBe(true);
    });

    it('ignores packages whose name merely starts with commander', () => {
        expect(ignored('/x/node_modules/commander-extra/index.js')).toBe(true);
        expect(
            ignored('/x/node_modules/.pnpm/commander-extra@1.0.0/node_modules/commander-extra/index.js'),
        ).toBe(true);
    });

    it('has a transform entry matching commander in both layouts', () => {
        expect(transformed(NPM_COMMANDER)).toBe(true);
        expect(transformed(PNPM_COMMANDER)).toBe(true);
    });
});
