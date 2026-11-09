/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    // Transpile-only (tsconfig.jest.json sets isolatedModules): ~2.5x less RSS
    // and faster cold start per suite process. Types are gated by
    // `npm run build` (src) and `npm run typecheck:tests` (tests).
    transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
        // commander >=15 ships ESM-only; Jest's CJS runtime cannot load it
        // natively, so transpile just that package to CJS.
        '^.+/node_modules/commander/.+\\.js$': [
            'ts-jest',
            { tsconfig: { allowJs: true, isolatedModules: true, module: 'commonjs' } },
        ],
    },
    // Jest matches realpaths: npm puts commander at node_modules/commander/,
    // pnpm at node_modules/.pnpm/commander@<ver>/node_modules/commander/.
    // Exempt both; `[@/]` keeps e.g. commander-extra ignored.
    transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/)?commander[@/])'],
    testEnvironment: 'node',
    // Off by default: instrumenting every file inflates memory for bare `jest`.
    // Use `npm run test:coverage` for coverage.
    collectCoverage: false,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
    coverageThreshold: {
        global: {
            branches: 90,
            functions: 90,
            lines: 90,
            statements: 90,
        },
    },
    setupFiles: ['<rootDir>/__tests__/support/fresh-native.ts'],
    globalSetup: '<rootDir>/__tests__/support/isolate-storage.ts',
    testMatch: ['**/*.test.ts'],
    roots: ['<rootDir>/__tests__'],
    verbose: true,
    resetModules: true,
    // Run tests sequentially to avoid tree-sitter parser interference
    maxWorkers: 1,
    // Force each test file to run in isolation with fresh module cache
    testRunner: 'jest-circus/runner',
    // Clear mocks and reset module registry between test files
    clearMocks: true,
    resetMocks: true,
};
