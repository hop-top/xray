import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { projectCacheDbPath } from '../src/lib/storage';

const CLI_PATH = path.join(__dirname, '../bin/cli.js');
const CLI_ENV = { ...process.env, XRAY_NO_TELEMETRY: '1', NO_COLOR: '1' };
const makeTmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), `xray-cli-complete-${prefix}-`));
const runCli = (args: string, cwd?: string) =>
    execSync(`node ${CLI_PATH} --no-telemetry --offline ${args}`, { cwd, env: CLI_ENV }).toString();

describe('CLI E2E - Complete Command Coverage', () => {
    beforeAll(() => {
        if (!fs.existsSync(CLI_PATH)) {
            execSync('npm run build', { stdio: 'inherit' });
        }
    });

    describe('cache clear command', () => {
        test('should show help', () => {
            const output = runCli('cache clear --help');
            expect(output).toContain('Usage: xray cache clear [options]');
            expect(output).toContain('Clear SQLite cache');
        });

        test('should clear cache database', () => {
            const root = makeTmp('cache');
            try {
                const cachePath = projectCacheDbPath(root)!;
                fs.mkdirSync(path.dirname(cachePath), { recursive: true });

                // Create a fake cache file
                fs.writeFileSync(cachePath, 'fake cache content');
                expect(fs.existsSync(cachePath)).toBe(true);

                // Run cache clear command in that directory
                runCli('--confirm=yes cache clear', root);

                // Cache should be deleted
                expect(fs.existsSync(cachePath)).toBe(false);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });

        test('should handle non-existent cache gracefully', () => {
            const root = makeTmp('cache-empty');
            try {
                // Cache doesn't exist, should not error and might show message or be silent
                const output = runCli('--confirm=yes cache clear', root);
                // Either shows message or silent - both are acceptable
                // Ignore the "Using config file" notice emitted when a config is found.
                const message = output
                    .split('\n')
                    .filter(line => !line.includes('Using config file'))
                    .join('\n')
                    .trim();
                expect(['No cache found', '']).toContain(message);
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });

        test('`--help-all` lists `cache` and omits removed `clear-cache`', () => {
            const output = runCli('--help-all');
            expect(output).toContain('cache');
            expect(output).not.toMatch(/^\s*clear-cache\b/m);
        });
    });

    describe('explore command features', () => {
        test('should list files by pattern with --match', () => {
            const root = makeTmp('explore-match');
            try {
                fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;');
                fs.writeFileSync(path.join(root, 'app.test.ts'), 'const test = 2;');
                fs.writeFileSync(path.join(root, 'utils.ts'), 'export const x = 1;');

                const output = runCli(`explore -p ${root} -m "*.ts"`);

                expect(output).toContain('app.ts');
                expect(output).toContain('utils.ts');
                expect(output).toContain('app.test.ts');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });

        test('should search for keywords with --search', () => {
            const root = makeTmp('explore-search');
            try {
                fs.writeFileSync(path.join(root, 'app.ts'), `
                    const API_KEY = 'secret';
                    function fetch() { return 'data'; }
                `);
                fs.writeFileSync(path.join(root, 'utils.ts'), `
                    const SECRET = 'value';
                    function init() { return 'ready'; }
                `);

                const output = runCli(`explore -p ${root} -s API_KEY -s SECRET 2>&1`);

                expect(output).toContain('Found matches');
                expect(output).toContain('[API_KEY]');
                expect(output).toContain('[SECRET]');
                expect(output).toContain('app.ts');
                expect(output).toContain('utils.ts');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });

        test('should show statistics with --stats', () => {
            const root = makeTmp('explore-stats');
            try {
                fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;const x = 2;');
                fs.writeFileSync(path.join(root, 'utils.js'), 'const y = 3;');

                const output = runCli(`explore -p ${root} --stats 2>&1`);

                expect(output).toContain('Codebase Statistics:');
                expect(output).toContain('Total Files: 2');
                expect(output).toContain('Total Lines:');
                expect(output).toContain('Files by Type:');
                expect(output).toContain('.ts');
                expect(output).toContain('.js');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });

        test('should show file list by default', () => {
            const root = makeTmp('explore-default');
            try {
                fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;');
                fs.writeFileSync(path.join(root, 'utils.ts'), 'export const x = 1;');

                const output = runCli(`explore -p ${root} 2>&1`);

                expect(output).toContain('Found 2 file(s):');
                expect(output).toContain('.ts (2):');
                expect(output).toContain('app.ts');
                expect(output).toContain('utils.ts');
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        });
    });
});