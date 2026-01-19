/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    collectCoverage: true,
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
    testMatch: ['**/*.test.ts'],
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
