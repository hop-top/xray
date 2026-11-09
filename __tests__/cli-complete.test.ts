import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { projectCacheDbPath } from '../src/lib/storage';

const CLI_PATH = path.join(__dirname, '../bin/cli.js');

describe('CLI E2E - Complete Command Coverage', () => {
    beforeAll(() => {
        if (!fs.existsSync(CLI_PATH)) {
            execSync('npm run build', { stdio: 'inherit' });
        }
    });

    describe('cache clear command', () => {
        test('should show help', () => {
            const output = execSync(`node ${CLI_PATH} cache clear --help`).toString();
            expect(output).toContain('Usage: xray cache clear [options]');
            expect(output).toContain('Clear SQLite cache');
        });

        test('should clear cache database', () => {
            const root = path.join(os.tmpdir(), 'xray-cli-complete-manual-cache');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            const cachePath = projectCacheDbPath(root)!;
            fs.mkdirSync(path.dirname(cachePath), { recursive: true });

            // Create a fake cache file
            fs.writeFileSync(cachePath, 'fake cache content');
            expect(fs.existsSync(cachePath)).toBe(true);

            // Run cache clear command in that directory
            execSync(`node ${CLI_PATH} --confirm=yes cache clear`, { cwd: root });

            // Cache should be deleted
            expect(fs.existsSync(cachePath)).toBe(false);

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should handle non-existent cache gracefully', () => {
            const root = path.join(os.tmpdir(), 'xray-cli-complete-manual-cache-empty');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            // Cache doesn't exist, should not error and might show message or be silent
            const output = execSync(`node ${CLI_PATH} --confirm=yes cache clear`, { cwd: root }).toString();
            // Either shows message or silent - both are acceptable
            // Ignore the "Using config file" notice emitted when a config is found.
            const message = output
                .split('\n')
                .filter(line => !line.includes('Using config file'))
                .join('\n')
                .trim();
            expect(['No cache found', '']).toContain(message);

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('deprecated `clear-cache` alias still resolves', () => {
            const root = path.join(__dirname, 'manual-cache-alias');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            const cachePath = projectCacheDbPath(root)!;
            fs.mkdirSync(path.dirname(cachePath), { recursive: true });
            fs.writeFileSync(cachePath, 'fake cache content');
            expect(fs.existsSync(cachePath)).toBe(true);

            execSync(`node ${CLI_PATH} --confirm=yes clear-cache`, { cwd: root });

            expect(fs.existsSync(cachePath)).toBe(false);

            fs.rmSync(root, { recursive: true, force: true });
        });

        test('--help omits hidden `clear-cache` alias but lists `cache`', () => {
            const output = execSync(`node ${CLI_PATH} --help`).toString();
            expect(output).toContain('cache');
            expect(output).not.toMatch(/^\s*clear-cache\b/m);
        });
    });

    describe('explore command features', () => {
        test('should list files by pattern with --match', () => {
            const root = path.join(os.tmpdir(), 'xray-cli-complete-manual-explore-match');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;');
            fs.writeFileSync(path.join(root, 'app.test.ts'), 'const test = 2;');
            fs.writeFileSync(path.join(root, 'utils.ts'), 'export const x = 1;');

            const output = execSync(`node ${CLI_PATH} explore -p ${root} -m "*.ts"`).toString();

            expect(output).toContain('app.ts');
            expect(output).toContain('utils.ts');
            expect(output).toContain('app.test.ts');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should search for keywords with --search', () => {
            const root = path.join(os.tmpdir(), 'xray-cli-complete-manual-explore-search');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'app.ts'), `
                const API_KEY = 'secret';
                function fetch() { return 'data'; }
            `);
            fs.writeFileSync(path.join(root, 'utils.ts'), `
                const SECRET = 'value';
                function init() { return 'ready'; }
            `);

            const output = execSync(`node ${CLI_PATH} explore -p ${root} -s API_KEY -s SECRET 2>&1`).toString();

            expect(output).toContain('Found matches');
            expect(output).toContain('[API_KEY]');
            expect(output).toContain('[SECRET]');
            expect(output).toContain('app.ts');
            expect(output).toContain('utils.ts');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should show statistics with --stats', () => {
            const root = path.join(os.tmpdir(), 'xray-cli-complete-manual-explore-stats');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;const x = 2;');
            fs.writeFileSync(path.join(root, 'utils.js'), 'const y = 3;');

            const output = execSync(`node ${CLI_PATH} explore -p ${root} --stats 2>&1`).toString();

            expect(output).toContain('Codebase Statistics:');
            expect(output).toContain('Total Files: 2');
            expect(output).toContain('Total Lines:');
            expect(output).toContain('Files by Type:');
            expect(output).toContain('.ts');
            expect(output).toContain('.js');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should show file list by default', () => {
            const root = path.join(os.tmpdir(), 'xray-cli-complete-manual-explore-default');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;');
            fs.writeFileSync(path.join(root, 'utils.ts'), 'export const x = 1;');

            const output = execSync(`node ${CLI_PATH} explore -p ${root} 2>&1`).toString();

            expect(output).toContain('Found 2 file(s):');
            expect(output).toContain('.ts (2):');
            expect(output).toContain('app.ts');
            expect(output).toContain('utils.ts');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });
    });
});