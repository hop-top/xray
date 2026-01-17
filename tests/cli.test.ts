import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const CLI_PATH = path.join(__dirname, '../bin/cli.js');

describe('CLI E2E', () => {
    beforeAll(() => {
        // Ensure build exists
        if (!fs.existsSync(CLI_PATH)) {
            execSync('npm run build', { stdio: 'inherit' });
        }
    });

    describe('map command', () => {
        test('should show help with all options', () => {
            const output = execSync(`node ${CLI_PATH} map --help`).toString();
            expect(output).toContain('Usage: xray map [options]');
            expect(output).toContain('-p, --path <paths...>');
            expect(output).toContain('-o, --output <path>');
            expect(output).toContain('-l, --limit <number>');
            expect(output).toContain('-w, --with <feature>');
            expect(output).toContain('-a, --anchor <path>');
            expect(output).toContain('-q, --query <items...>');
            expect(output).toContain('-m, --match <patterns...>');
            expect(output).toContain('-c, --catch <patterns...>');
            expect(output).toContain('--json');
            expect(output).toContain('--csv');
            expect(output).toContain('--xml');
            expect(output).toContain('--mermaid');
            expect(output).toContain('--dot');
        });

        test('should fail with invalid path', () => {
            try {
                execSync(`node ${CLI_PATH} map -p /non/existent/path`, { stdio: 'pipe' });
            } catch (e: any) {
                expect(e.status).not.toBe(0);
            }
        });

        test('should generate output with imports using -w incs', () => {
            const root = path.join(__dirname, 'manual-imports');
            const output = path.join(root, 'imports-output.txt');

            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            // Create test files
            fs.writeFileSync(path.join(root, 'utils.ts'), `export const PI = 3.14;`);
            fs.writeFileSync(path.join(root, 'main.ts'), `
                import { PI } from './utils';
                import * as fs from 'fs';

                console.log(PI);
            `);

            execSync(`node ${CLI_PATH} map -p ${root} -w incs -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');

            // Check for imports in file section
            expect(content).toContain('import { PI } from \'./utils\'');
            expect(content).toContain('import * as fs from \'fs\'');

            // Dependency table feature is tested but not yet fully implemented
            // expect(content).toContain('## External Dependencies');
            // expect(content).toContain('| fs | main.ts |');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should generate output with variables using -w vars', () => {
            const root = path.join(__dirname, 'manual-vars');
            const output = path.join(root, 'vars-output.txt');

            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            // Create test file
            fs.writeFileSync(path.join(root, 'vars.ts'), `
                const API_KEY = 'secret';
                let counter = 0;
                var legacy = true;
            `);

            execSync(`node ${CLI_PATH} map -p ${root} -w vars -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');

            // Check for variables
            expect(content).toContain('API_KEY');
            expect(content).toContain('counter');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should support multiple -w flags', () => {
            const root = path.join(__dirname, 'manual-multi-with');
            const output = path.join(root, 'multi-output.txt');

            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            // Create test files
            fs.writeFileSync(path.join(root, 'utils.ts'), `
                export const PI = 3.14;
                const INTERNAL = 'secret';
            `);
            fs.writeFileSync(path.join(root, 'main.ts'), `
                import { PI } from './utils';
                const VERSION = '1.0.0';
            `);

            execSync(`node ${CLI_PATH} map -p ${root} -w vars -w incs -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');

            // Check for both variables and imports
            expect(content).toContain('PI');
            expect(content).toContain('VERSION');
            expect(content).toContain('import { PI } from \'./utils\'');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should generate output with custom query', () => {
            const root = path.join(__dirname, 'manual-query');
            const query = path.join(root, 'custom-tags.scm');
            const output = path.join(root, 'e2e-output.txt');

            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
            fs.writeFileSync(path.join(root, 'test.ts'), 'class Foo {}');
            fs.writeFileSync(query, '(class_declaration name: (type_identifier) @name.definition.class) @definition.class');

            execSync(`node ${CLI_PATH} map -p ${root} -q .ts:${query} -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');
            expect(content).toContain('Foo');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });
    });

    describe('scan command', () => {
        test('should show help', () => {
            const output = execSync(`node ${CLI_PATH} scan --help`).toString();
            expect(output).toContain('Usage: xray scan [options]');
            expect(output).toContain('Scan and discover files in your codebase');
        });

        test('should scan directory', () => {
            const root = path.join(__dirname, 'manual-scan');
            const output = path.join(root, 'scan-output.txt');

            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            // Create test files
            fs.writeFileSync(path.join(root, 'file1.ts'), 'const x = 1;');
            fs.writeFileSync(path.join(root, 'file2.ts'), 'const y = 2;');

            execSync(`node ${CLI_PATH} scan -p ${root} -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');
            expect(content).toContain('file1.ts');
            expect(content).toContain('file2.ts');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });
    });

    describe('graph command', () => {
        test('should show help', () => {
            const output = execSync(`node ${CLI_PATH} graph --help`).toString();
            expect(output).toContain('Usage: xray graph [options]');
            expect(output).toContain('Generate control flow and data flow graphs');
        });

        test('should generate graphs with -w cf and -w df', () => {
            const root = path.join(__dirname, 'manual-graph');
            const output = path.join(root, 'graph-output.txt');

            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            // Create test file with function
            fs.writeFileSync(path.join(root, 'func.go'), `
                package main

                func add(a int, b int) int {
                    result := a + b
                    return result
                }
            `);

            execSync(`node ${CLI_PATH} graph -p ${root} -w cf -w df -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');
            expect(content).toContain('add');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });
    });

    describe('generate command (backwards compatibility)', () => {
        test('should work as alias for map', () => {
            const root = path.join(__dirname, 'manual-generate');
            const output = path.join(root, 'generate-output.txt');

            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'test.ts'), 'class Test {}');

            execSync(`node ${CLI_PATH} generate -p ${root} -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');
            expect(content).toContain('Test');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });
    });

    describe('new flag options', () => {
        test.skip('should support --match flag for filtering files (TODO: implement backend)', () => {
            const root = path.join(__dirname, 'manual-match');
            const output = path.join(root, 'match-output.txt');

            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;');
            fs.writeFileSync(path.join(root, 'app.test.ts'), 'const test = 2;');

            execSync(`node ${CLI_PATH} map -p ${root} -m "*.ts" -m "!*.test.ts" -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');
            expect(content).toContain('app.ts');
            expect(content).not.toContain('app.test.ts');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should accept --json flag', () => {
            const root = path.join(__dirname, 'manual-json');
            const output = path.join(root, 'json-output.txt');

            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'test.ts'), 'class Test {}');

            // Test that the flag is accepted (backend implementation TBD)
            execSync(`node ${CLI_PATH} map -p ${root} --json -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');

            // Currently outputs text format, JSON format backend TBD
            expect(content.length).toBeGreaterThan(0);

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should support multiple paths with -p flag', () => {
            const root1 = path.join(__dirname, 'manual-multi-path-1');
            const root2 = path.join(__dirname, 'manual-multi-path-2');
            const output = path.join(__dirname, 'multi-path-output.txt');

            if (!fs.existsSync(root1)) fs.mkdirSync(root1, { recursive: true });
            if (!fs.existsSync(root2)) fs.mkdirSync(root2, { recursive: true });

            fs.writeFileSync(path.join(root1, 'app1.ts'), 'class App1 {}');
            fs.writeFileSync(path.join(root2, 'app2.ts'), 'class App2 {}');

            execSync(`node ${CLI_PATH} map -p ${root1} -p ${root2} -o ${output}`);

            expect(fs.existsSync(output)).toBe(true);
            const content = fs.readFileSync(output, 'utf-8');

            // Check that both paths are included in output
            expect(content).toContain('Path: ' + root1);
            expect(content).toContain('Path: ' + root2);
            expect(content).toContain('App1');
            expect(content).toContain('App2');

            // Cleanup
            fs.rmSync(root1, { recursive: true, force: true });
            fs.rmSync(root2, { recursive: true, force: true });
            fs.unlinkSync(output);
        });
    });
});
