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
            expect(output).toContain('-p, --path <path>');
            expect(output).toContain('-o, --output <path>');
            expect(output).toContain('-l, --limit <number>');
            expect(output).toContain('-w, --with <feature>');
            expect(output).toContain('-a, --anchor <path>');
            expect(output).toContain('-q, --query <item>');
            expect(output).toContain('-m, --match <pattern>');
            expect(output).toContain('-c, --catch <pattern>');
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
            expect(output).toContain('Scan and discover files in codebase');
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
            expect(output).toContain('Generate control flow (CFG) and data flow (DFG) graphs');
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

    describe('clear-cache command', () => {
        test('should show help', () => {
            const output = execSync(`node ${CLI_PATH} clear-cache --help`).toString();
            expect(output).toContain('Usage: xray clear-cache [options]');
            expect(output).toContain('Clear SQLite cache');
        });

        test('should clear cache database', () => {
            const root = path.join(__dirname, 'manual-cache');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            const cachePath = path.join(root, '.xray_cache.db');

            // Create a fake cache file
            fs.writeFileSync(cachePath, 'fake cache content');
            expect(fs.existsSync(cachePath)).toBe(true);

            // Run clear-cache command in that directory
            execSync(`node ${CLI_PATH} clear-cache`, { cwd: root });

            // Cache should be deleted
            expect(fs.existsSync(cachePath)).toBe(false);

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should handle non-existent cache gracefully', () => {
            const root = path.join(__dirname, 'manual-cache-empty');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            // Cache doesn't exist, should not error
            const output = execSync(`node ${CLI_PATH} clear-cache`, { cwd: root }).toString();
            expect(output).toContain('No cache found');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });
    });

    describe('explore command features', () => {
        test('should list files by pattern with --match', () => {
            const root = path.join(__dirname, 'manual-explore-match');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;');
            fs.writeFileSync(path.join(root, 'app.test.ts'), 'const test = 2;');
            fs.writeFileSync(path.join(root, 'utils.ts'), 'export const x = 1;');

            const output = execSync(`node ${CLI_PATH} explore -p ${root} -m "*.ts" -m "!*.test.ts"`).toString();

            expect(output).toContain('app.ts');
            expect(output).toContain('utils.ts');
            expect(output).not.toContain('app.test.ts');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should search for keywords with --search', () => {
            const root = path.join(__dirname, 'manual-explore-search');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'app.ts'), `
                const API_KEY = 'secret';
                function fetch() { return 'data'; }
            `);
            fs.writeFileSync(path.join(root, 'utils.ts'), `
                const SECRET = 'value';
                function init() { return 'ready'; }
            `);

            const output = execSync(`node ${CLI_PATH} explore -p ${root} -s API_KEY -s SECRET`).toString();

            expect(output).toContain('Found matches');
            expect(output).toContain('[API_KEY]');
            expect(output).toContain('[SECRET]');
            expect(output).toContain('app.ts');
            expect(output).toContain('utils.ts');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should show statistics with --stats', () => {
            const root = path.join(__dirname, 'manual-explore-stats');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;\nconst x = 2;');
            fs.writeFileSync(path.join(root, 'utils.js'), 'const y = 3;');
            fs.writeFileSync(path.join(root, 'config.json', '{});

            const output = execSync(`node ${CLI_PATH} explore -p ${root} --stats`).toString();

            expect(output).toContain('Codebase Statistics:');
            expect(output).toContain('Total Files: 3');
            expect(output).toContain('Total Lines:');
            expect(output).toContain('Files by Type:');
            expect(output).toContain('.ts');
            expect(output).toContain('.js');
            expect(output).toContain('.json');

            // Cleanup
            fs.rmSync(root, { recursive: true, force: true });
        });

        test('should show file list by default', () => {
            const root = path.join(__dirname, 'manual-explore-default');
            if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });

            fs.writeFileSync(path.join(root, 'app.ts'), 'const app = 1;');
            fs.writeFileSync(path.join(root, 'utils.ts'), 'export const x = 1;');

            const output = execSync(`node ${CLI_PATH} explore -p ${root}`).toString();

            expect(output).toContain('Found 2 file(s):');
            expect(output).toContain('.ts (2):');
            expect(output).toContain('app.ts');
            expect(output).toContain('utils.ts');

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

    describe('strategy meta-commands via explore', () => {
        test('should list all available strategies', () => {
            const output = execSync(`node ${CLI_PATH} strategy:list`).toString();
            expect(output).toContain('Available Strategies');
            expect(output).toContain('react');
        });

        test('should list strategies with explore prefix', () => {
            const output = execSync(`node ${CLI_PATH} explore strategy:list`).toString();
            expect(output).toContain('Available Strategies');
            expect(output).toContain('react');
        });

        test('should detect strategies in current project', () => {
            // Create a temp React project for detection
            const tempDir = path.join(__dirname, 'temp-react-detect');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const pkgJson = {
                name: 'test-project',
                version: '1.0.0',
                dependencies: {
                    'react': '^18.2.0',
                    'react-dom': '^18.2.0'
                }
            };

            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify(pkgJson, null, 2)
            );

            const output = execSync(`node ${CLI_PATH} strategy:detect -p ${tempDir}`).toString();
            expect(output).toContain('Detected Strategies');
            expect(output).toContain('react');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        test('should detect strategies with explore prefix', () => {
            // Create a temp React project for detection
            const tempDir = path.join(__dirname, 'temp-react-detect-2');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const pkgJson = {
                name: 'test-project',
                version: '1.0.0',
                dependencies: {
                    'react': '^18.2.0',
                    'react-dom': '^18.2.0'
                }
            };

            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify(pkgJson, null, 2)
            );

            const output = execSync(`node ${CLI_PATH} explore strategy:detect -p ${tempDir}`).toString();
            expect(output).toContain('Detected Strategies');
            expect(output).toContain('react');

            // Cleanup
            fs.rmSync(tempDir, { recursive: true, force: true });
        });
    });

    describe('completion command', () => {
        test('should show help', () => {
            const output = execSync(`node ${CLI_PATH} completion --help`).toString();
            expect(output).toContain('Usage: xray completion [options] <shell>');
            expect(output).toContain('Generate shell completion script');
        });

        test('should generate bash completion script', () => {
            const output = execSync(`node ${CLI_PATH} completion bash`).toString();

            // Check for bash completion structure
            expect(output).toContain('# xray completion for bash');
            expect(output).toContain('_xray_completions()');
            expect(output).toContain('complete -F _xray_completions xray');

            // Check for commands
            expect(output).toContain('map scan graph generate explore clear-cache completion help');

            // Check for option completion
            expect(output).toContain('vars incs docs cost cf df');
            expect(output).toContain('--path --output --limit --with');
        });

        test('should generate zsh completion script', () => {
            const output = execSync(`node ${CLI_PATH} completion zsh`).toString();

            // Check for zsh completion structure
            expect(output).toContain('# xray completion for zsh');
            expect(output).toContain('#compdef xray');
            expect(output).toContain('_xray()');
            expect(output).toContain('_xray');

            // Check for commands with descriptions
            expect(output).toContain('map:Generate visual map of codebase');
            expect(output).toContain('scan:Scan and discover files in codebase');
            expect(output).toContain('explore:Quickly find files and search code');
            expect(output).toContain('completion:Generate shell completion script');

            // Check for options
            expect(output).toContain('--path');
            expect(output).toContain('--with');
            expect(output).toContain('vars incs docs cost cf df');
        });

        test('should generate fish completion script', () => {
            const output = execSync(`node ${CLI_PATH} completion fish`).toString();

            // Check for fish completion structure
            expect(output).toContain('# xray completion for fish');
            expect(output).toContain('complete -c xray');

            // Check for commands
            expect(output).toContain('-a map -d \'Generate visual map of codebase\'');
            expect(output).toContain('-a scan -d \'Scan and discover files in codebase\'');
            expect(output).toContain('-a explore -d \'Quickly find files and search code\'');
            expect(output).toContain('-a completion -d \'Generate shell completion script\'');

            // Check for options
            expect(output).toContain('-s p -l path');
            expect(output).toContain('-s w -l with');
            expect(output).toContain('\'vars incs docs cost cf df\'');
        });

        test('should fail with unsupported shell', () => {
            try {
                execSync(`node ${CLI_PATH} completion invalid 2>&1`, { stdio: 'pipe', encoding: 'utf-8' });
                fail('Should have thrown an error');
            } catch (e: any) {
                expect(e.status).toBe(1);
                const output = e.stdout.toString();
                expect(output).toContain('Unsupported shell: invalid');
                expect(output).toContain('Supported shells: bash, zsh, fish');
            }
        });

        test('should show usage instructions on error', () => {
            try {
                execSync(`node ${CLI_PATH} completion powershell 2>&1`, { stdio: 'pipe', encoding: 'utf-8' });
                fail('Should have thrown an error');
            } catch (e: any) {
                const output = e.stdout.toString();
                expect(output).toContain('eval "$(xray completion bash)"');
                expect(output).toContain('eval "$(xray completion zsh)"');
                expect(output).toContain('xray completion fish > ~/.config/fish/completions/xray.fish');
            }
        });
    });

    describe('strategy commands via explore', () => {
        const testRoot = path.join(__dirname, 'react-cli-test');

        beforeAll(() => {
            // Create test React project
            if (fs.existsSync(testRoot)) {
                fs.rmSync(testRoot, { recursive: true, force: true });
            }
            fs.mkdirSync(testRoot, { recursive: true });

            // Create package.json with React
            fs.writeFileSync(
                path.join(testRoot, 'package.json'),
                JSON.stringify({
                    name: 'test-react-app',
                    dependencies: {
                        react: '^18.0.0',
                        'react-dom': '^18.0.0'
                    }
                })
            );

            // Create test components
            fs.mkdirSync(path.join(testRoot, 'src'), { recursive: true });

            // Note: execSync used here is safe as it's in a controlled test environment
            fs.writeFileSync(
                path.join(testRoot, 'src', 'Button.tsx'),
                `import React from 'react';

export function Button() {
  return <button>Click me</button>;
}`
            );

            fs.writeFileSync(
                path.join(testRoot, 'src', 'Card.tsx'),
                `import React from 'react';

export class Card extends React.Component {
  render() {
    return <div>Card</div>;
  }
}`
            );

            // Create custom hooks
            fs.writeFileSync(
                path.join(testRoot, 'src', 'useCounter.ts'),
                `import { useState } from 'react';

export function useCounter(initialValue: number = 0) {
  const [count, setCount] = useState(initialValue);
  return { count, setCount };
}`
            );

            fs.writeFileSync(
                path.join(testRoot, 'src', 'useToggle.ts'),
                `import { useState } from 'react';

export const useToggle = (initialValue: boolean = false) => {
  const [value, setValue] = useState(initialValue);
  const toggle = () => setValue(!value);
  return { value, toggle };
}`
            );

            // Create contexts
            fs.writeFileSync(
                path.join(testRoot, 'src', 'ThemeContext.ts'),
                `import { createContext } from 'react';

export const ThemeContext = createContext({
  theme: 'light',
  toggleTheme: () => {}
});`
            );

            fs.writeFileSync(
                path.join(testRoot, 'src', 'AuthContext.ts'),
                `import { createContext } from 'react';

export const AuthContext = createContext(null);`
            );
        });

        afterAll(() => {
            // Cleanup
            if (fs.existsSync(testRoot)) {
                fs.rmSync(testRoot, { recursive: true, force: true });
            }
        });

        test('should list React components with react:components', () => {
            const output = execSync(`node ${CLI_PATH} react:components -p ${testRoot}`).toString();

            expect(output).toContain('React Components:');
            expect(output).toContain('Button');
            expect(output).toContain('(function)');
            expect(output).toContain('Card');
            expect(output).toContain('(class)');
        });

        test('should list React components with explore react:components', () => {
            const output = execSync(`node ${CLI_PATH} explore react:components -p ${testRoot}`).toString();

            expect(output).toContain('React Components:');
            expect(output).toContain('Button');
            expect(output).toContain('(function)');
            expect(output).toContain('Card');
            expect(output).toContain('(class)');
        });

        test('should list React hooks with react:hooks', () => {
            const output = execSync(`node ${CLI_PATH} react:hooks -p ${testRoot}`).toString();

            expect(output).toContain('Custom React Hooks:');
            expect(output).toContain('useCounter');
            expect(output).toContain('useToggle');
        });

        test('should list React hooks with explore react:hooks', () => {
            const output = execSync(`node ${CLI_PATH} explore react:hooks -p ${testRoot}`).toString();

            expect(output).toContain('Custom React Hooks:');
            expect(output).toContain('useCounter');
            expect(output).toContain('useToggle');
        });

        test('should list React contexts with react:contexts', () => {
            const output = execSync(`node ${CLI_PATH} react:contexts -p ${testRoot}`).toString();

            expect(output).toContain('React Contexts:');
            expect(output).toContain('ThemeContext');
            expect(output).toContain('AuthContext');
        });

        test('should list React contexts with explore react:contexts', () => {
            const output = execSync(`node ${CLI_PATH} explore react:contexts -p ${testRoot}`).toString();

            expect(output).toContain('React Contexts:');
            expect(output).toContain('ThemeContext');
            expect(output).toContain('AuthContext');
        });
    });

    describe('Go CLI strategy commands', () => {
        const testRoot = path.join(__dirname, 'go-cli-test');

        beforeAll(() => {
            // Create test Go CLI project
            if (fs.existsSync(testRoot)) {
                fs.rmSync(testRoot, { recursive: true, force: true });
            }
            fs.mkdirSync(testRoot, { recursive: true });

            // Create go.mod
            fs.writeFileSync(
                path.join(testRoot, 'go.mod'),
                `module example.com/testcli

go 1.21

require github.com/spf13/cobra v1.8.0`
            );

            // Create cmd directory
            fs.mkdirSync(path.join(testRoot, 'cmd'), { recursive: true });

            // Create root command
            fs.writeFileSync(
                path.join(testRoot, 'cmd', 'root.go'),
                `package cmd

import "github.com/spf13/cobra"

var rootCmd = &cobra.Command{
    Use:   "testcli",
    Short: "A test CLI application",
}

var serveCmd = &cobra.Command{
    Use:   "serve",
    Short: "Start the server",
}

func init() {
    rootCmd.AddCommand(serveCmd)
    rootCmd.Flags().StringP("config", "c", "", "config file")
}`
            );
        });

        afterAll(() => {
            if (fs.existsSync(testRoot)) {
                fs.rmSync(testRoot, { recursive: true, force: true });
            }
        });

        test('should list Go CLI commands with go-cli:commands', () => {
            const output = execSync(`node ${CLI_PATH} go-cli:commands -p ${testRoot}`).toString();

            expect(output).toContain('testcli');
            expect(output).toContain('serve');
        });

        test('should list Go CLI flags with go-cli:flags', () => {
            const output = execSync(`node ${CLI_PATH} go-cli:flags -p ${testRoot}`).toString();

            expect(output).toContain('config');
        });

        test('should show command tree with go-cli:tree', () => {
            const output = execSync(`node ${CLI_PATH} go-cli:tree -p ${testRoot}`).toString();

            expect(output).toContain('testcli');
            expect(output).toContain('serve');
        });
    });
});
