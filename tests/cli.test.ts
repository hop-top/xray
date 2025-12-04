import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const CLI_PATH = path.join(__dirname, '../dist/cli.js');

describe('CLI E2E', () => {
    beforeAll(() => {
        // Ensure build exists
        if (!fs.existsSync(CLI_PATH)) {
            execSync('npm run build', { stdio: 'inherit' });
        }
    });

    test('should show help with all options', () => {
        const output = execSync(`node ${CLI_PATH} generate --help`).toString();
        expect(output).toContain('Usage: xray generate [options]');
        expect(output).toContain('--root <path>');
        expect(output).toContain('--output <path>');
        expect(output).toContain('--tokens <number>');
        expect(output).toContain('--include-variables');
        expect(output).toContain('--doc <config>');
        expect(output).toContain('--focus <path>');
        expect(output).toContain('--cfg');
        expect(output).toContain('--dfg');
        expect(output).toContain('--json');
        expect(output).toContain('--query <items...>');
    });

    test('should fail with invalid root', () => {
        try {
            execSync(`node ${CLI_PATH} generate --root /non/existent/path`, { stdio: 'pipe' });
        } catch (e: any) {
            expect(e.status).not.toBe(0);
        }
    });

    test('should generate output with imports and dependency table', () => {
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

        execSync(`node ${CLI_PATH} generate --root ${root} --include-imports --output ${output}`);

        expect(fs.existsSync(output)).toBe(true);
        const content = fs.readFileSync(output, 'utf-8');

        // Check for imports in file section
        expect(content).toContain('import { PI } from \'./utils\'');
        expect(content).toContain('import * as fs from \'fs\'');

        // Check for dependency table
        expect(content).toContain('## External Dependencies');
        expect(content).toContain('| fs | main.ts |');

        // Cleanup
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('should generate output for manual test', () => {
        const root = path.join(__dirname, 'manual');
        const query = path.join(root, 'custom-tags.scm');
        const output = path.join(root, 'e2e-output.txt');

        // Re-create manual test files if needed (they might have been cleaned up)
        if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
        fs.writeFileSync(path.join(root, 'test.ts'), 'class Foo {}');
        fs.writeFileSync(query, '(class_declaration name: (type_identifier) @name.definition.class) @definition.class');

        execSync(`node ${CLI_PATH} generate --root ${root} --query .ts:${query} --output ${output}`);

        expect(fs.existsSync(output)).toBe(true);
        const content = fs.readFileSync(output, 'utf-8');
        expect(content).toContain('Foo');

        // Cleanup
        fs.rmSync(root, { recursive: true, force: true });
    });
});
