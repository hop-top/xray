import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const CLI_PATH = path.join(__dirname, '../bin/xray');

describe('Strategy Command E2E', () => {
  let testRoot: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      execSync('npm run build', { stdio: 'inherit' });
    }
  });

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-strategy-test-'));
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('strategy list', () => {
    test('should list all available strategies', () => {
      const output = execSync(`node ${CLI_PATH} strategy list 2>&1`).toString();
      expect(output).toContain('Available Strategies');
      expect(output).toContain('react');
    });

    test('should list strategies with ls alias', () => {
      const output = execSync(`node ${CLI_PATH} strategy ls 2>&1`).toString();
      expect(output).toContain('Available Strategies');
      expect(output).toContain('react');
    });

    test('should show version information for each strategy', () => {
      const output = execSync(`node ${CLI_PATH} strategy list 2>&1`).toString();
      expect(output).toMatch(/react v\d+\.\d+\.\d+/);
    });

    test('should list multiple strategies', () => {
      const output = execSync(`node ${CLI_PATH} strategy list 2>&1`).toString();
      expect(output).toContain('express');
      expect(output).toContain('nextjs');
      expect(output).toContain('react');
    });
  });

  describe('strategy detect', () => {
    test('should detect strategies in current project', () => {
      const output = execSync(`node ${CLI_PATH} strategy detect 2>&1`).toString();
      expect(output).toContain('Detecting strategies');
      expect(output).toContain('Detected Strategies');
    });

    test('should detect React strategy in React project', () => {
      const reactProject = path.join(testRoot, 'react-app');
      fs.mkdirSync(reactProject, { recursive: true });
      fs.writeFileSync(
        path.join(reactProject, 'package.json'),
        JSON.stringify({
          name: 'test-react-app',
          dependencies: {
            react: '^18.2.0',
            'react-dom': '^18.2.0'
          }
        }, null, 2)
      );

      const output = execSync(`node ${CLI_PATH} strategy detect -p ${reactProject} 2>&1`).toString();
      expect(output).toContain('Detected Strategies');
      expect(output).toContain('react');
    });

    test('should not detect React in non-React project', () => {
      const plainProject = path.join(testRoot, 'plain-app');
      fs.mkdirSync(plainProject, { recursive: true });
      fs.writeFileSync(
        path.join(plainProject, 'package.json'),
        JSON.stringify({
          name: 'test-plain-app',
          dependencies: {}
        }, null, 2)
      );

      const output = execSync(`node ${CLI_PATH} strategy detect -p ${plainProject} 2>&1`).toString();
      expect(output).toContain('Detecting strategies');
      // Generic strategies (build, package-manager) legitimately match any
      // package.json project; only framework strategies must stay undetected.
      expect(output).not.toContain('react');
      expect(output).not.toContain('nextjs');
      expect(output).not.toContain('express');
    });

    test('should fail with non-existent path', () => {
      expect(() => {
        execSync(`node ${CLI_PATH} strategy detect -p /non/existent/path 2>&1`, { encoding: 'utf-8' });
      }).toThrow();
    });
  });

  describe('strategy info', () => {
    test('should show info for existing strategy', () => {
      const output = execSync(`node ${CLI_PATH} strategy info react 2>&1`).toString();
      expect(output).toContain('Strategy: react');
      expect(output).toContain('Version:');
      expect(output).toContain('Commands:');
      expect(output).toContain('react:components');
    });

    test('should show file types for strategy', () => {
      const output = execSync(`node ${CLI_PATH} strategy info react 2>&1`).toString();
      expect(output).toContain('File Types:');
      expect(output).toContain('.tsx');
      expect(output).toContain('.jsx');
    });

    test('should show detection status for current project', () => {
      const output = execSync(`node ${CLI_PATH} strategy info react 2>&1`).toString();
      expect(output).toContain('Detected in current project:');
      expect(output).toMatch(/Yes|No/);
    });

    test('should fail for non-existent strategy', () => {
      expect(() => {
        execSync(`node ${CLI_PATH} strategy info non-existent-strategy 2>&1`, { encoding: 'utf-8' });
      }).toThrow();
    });
  });

  describe('strategy create', () => {
    test('should create a YAML strategy by default', () => {
      const strategyName = 'test-yaml-strategy';
      const output = execSync(`node ${CLI_PATH} strategy create ${strategyName} 2>&1`, { cwd: testRoot }).toString();

      expect(output).toContain('Strategy created');
      expect(output).toContain('.xray/strategies');

      const strategyFile = path.join(testRoot, '.xray/strategies', `${strategyName}.yml`);
      expect(fs.existsSync(strategyFile)).toBe(true);

      const content = fs.readFileSync(strategyFile, 'utf-8');
      expect(content).toContain(`name: ${strategyName}`);
      expect(content).toContain('version: 0.1.0');
    });

    test('should create a TypeScript strategy with --ts flag', () => {
      const strategyName = 'test-ts-strategy';
      const output = execSync(`node ${CLI_PATH} strategy create ${strategyName} --ts 2>&1`, { cwd: testRoot }).toString();

      expect(output).toContain('Strategy created');

      const strategyFile = path.join(testRoot, '.xray/strategies', `${strategyName}.ts`);
      expect(fs.existsSync(strategyFile)).toBe(true);

      const content = fs.readFileSync(strategyFile, 'utf-8');
      expect(content).toContain(`name: '${strategyName}'`);
      expect(content).toContain('Strategy, StrategyContext, FileMetadata');
    });

    test('should create strategy in custom directory', () => {
      const customDir = path.join(testRoot, 'custom-strategies');
      const strategyName = 'custom-strategy';
      execSync(`node ${CLI_PATH} strategy create ${strategyName} --yaml -d ${customDir} 2>&1`);

      const strategyFile = path.join(customDir, `${strategyName}.yml`);
      expect(fs.existsSync(strategyFile)).toBe(true);
    });

    test('should fail if strategy already exists', () => {
      const strategyName = 'existing-strategy';
      const strategyFile = path.join(testRoot, '.xray/strategies', `${strategyName}.yml`);
      fs.mkdirSync(path.dirname(strategyFile), { recursive: true });
      fs.writeFileSync(strategyFile, 'name: existing-strategy\nversion: 1.0.0');

      expect(() => {
        execSync(`node ${CLI_PATH} strategy create ${strategyName} 2>&1`, { cwd: testRoot, encoding: 'utf-8' });
      }).toThrow();
    });

    test('should include next steps in output', () => {
      const output = execSync(`node ${CLI_PATH} strategy create next-steps-test 2>&1`, { cwd: testRoot }).toString();
      expect(output).toContain('Next steps:');
      expect(output).toContain('Edit the');
      expect(output).toContain('strategy detect');
    });
  });

  describe('strategy remove', () => {
    test('should remove an installed strategy', () => {
      const strategyName = 'remove-test-strategy';
      const strategyFile = path.join(testRoot, '.xray/strategies', `${strategyName}.yml`);
      fs.mkdirSync(path.dirname(strategyFile), { recursive: true });
      fs.writeFileSync(strategyFile, `name: ${strategyName}\nversion: 1.0.0`);

      expect(fs.existsSync(strategyFile)).toBe(true);

      const output = execSync(`node ${CLI_PATH} --confirm=yes strategy remove ${strategyName} 2>&1`, { cwd: testRoot }).toString();
      expect(output).toContain('Strategy removed');

      expect(fs.existsSync(strategyFile)).toBe(false);
    });

    test('should remove strategy with uninstall alias', () => {
      const strategyName = 'uninstall-test-strategy';
      const strategyFile = path.join(testRoot, '.xray/strategies', `${strategyName}.yml`);
      fs.mkdirSync(path.dirname(strategyFile), { recursive: true });
      fs.writeFileSync(strategyFile, `name: ${strategyName}\nversion: 1.0.0`);

      const output = execSync(`node ${CLI_PATH} --confirm=yes strategy uninstall ${strategyName} 2>&1`, { cwd: testRoot }).toString();
      expect(output).toContain('Strategy removed');
    });

    test('should fail for non-existent strategy', () => {
      expect(() => {
        execSync(`node ${CLI_PATH} strategy remove non-existent 2>&1`, { encoding: 'utf-8' });
      }).toThrow();
    });
  });

  describe('strategy path', () => {
    test('should show all strategy search paths', () => {
      const output = execSync(`node ${CLI_PATH} strategy path 2>&1`).toString();
      expect(output).toContain('Strategy Search Paths');
      expect(output).toContain('.xray/strategies');
      expect(output).toContain('node_modules');
    });

    test('should indicate which paths exist', () => {
      const output = execSync(`node ${CLI_PATH} strategy path 2>&1`).toString();
      expect(output).toMatch(/\(\s*not found\s*\)|$/m);
    });
  });

  describe('strategy validate', () => {
    test('should validate an existing strategy', () => {
      const strategyName = 'validate-test';
      const strategyFile = path.join(testRoot, '.xray/strategies', `${strategyName}.yml`);
      fs.mkdirSync(path.dirname(strategyFile), { recursive: true });
      fs.writeFileSync(strategyFile, `name: ${strategyName}\nversion: 1.0.0`);

      const output = execSync(`node ${CLI_PATH} strategy validate ${strategyName} 2>&1`, { cwd: testRoot }).toString();
      expect(output).toContain('Validating strategy');
      expect(output).toContain('Name:');
      expect(output).toContain('Version:');
      expect(output).toContain('Validation complete');
    });

    test('should show validation output format for built-in strategy', () => {
      const output = execSync(`node ${CLI_PATH} strategy validate react 2>&1`).toString();
      expect(output).toContain('Validating strategy');
      expect(output).toContain('Name: react');
      expect(output).toContain('Has detect: Yes');
      expect(output).toContain('Has analyze: Yes');
      expect(output).toContain('Commands:');
    });

    test('should fail for non-existent strategy', () => {
      expect(() => {
        execSync(`node ${CLI_PATH} strategy validate non-existent 2>&1`, { encoding: 'utf-8' });
      }).toThrow();
    });
  });

  describe('strategy install', () => {
    test('should show install help when no source provided', () => {
      expect(() => {
        execSync(`node ${CLI_PATH} strategy install 2>&1`, { encoding: 'utf-8' });
      }).toThrow();
    });

    test('local file is read, not installed, and says so', () => {
      const strategyName = 'local-install-test';
      const sourceFile = path.join(testRoot, `${strategyName}.yml`);
      fs.writeFileSync(sourceFile, `name: ${strategyName}\nversion: 1.0.0`);

      const output = execSync(`node ${CLI_PATH} strategy install ${sourceFile} 2>&1`, { cwd: testRoot }).toString();
      expect(output).toContain(strategyName);
      expect(output).toMatch(/nothing was installed or copied/i);
      expect(output).not.toContain('Strategy installed');
      expect(fs.existsSync(path.join(testRoot, '.xray'))).toBe(false);
    });

    test('should fail for non-existent path', () => {
      expect(() => {
        execSync(`node ${CLI_PATH} strategy install /non/existent/path 2>&1`, { encoding: 'utf-8' });
      }).toThrow();
    });
  });

  describe('strategy help', () => {
    test('should show strategy command help', () => {
      const output = execSync(`node ${CLI_PATH} strategy --help 2>&1`).toString();
      expect(output).toContain('Manage strategies');
      expect(output).toContain('list');
      expect(output).toContain('detect');
      expect(output).toContain('create');
      expect(output).toContain('install');
      expect(output).toContain('remove');
      expect(output).toContain('validate');
      expect(output).toContain('info');
      expect(output).toContain('path');
    });

    test('should show help for specific subcommand', () => {
      const output = execSync(`node ${CLI_PATH} strategy create --help 2>&1`).toString();
      expect(output).toContain('Create a new strategy scaffold');
      expect(output).toContain('--yaml');
      expect(output).toContain('--ts');
      expect(output).toContain('-d, --dir');
    });
  });

  describe('backwards compatibility', () => {
    // The colon meta-command form (`strategy:list`) was replaced by the
    // space-separated subcommand form in af1af00; `strategy list` supersedes it.
    test('strategy list (replaces strategy:list) should list strategies', () => {
      const output = execSync(`node ${CLI_PATH} strategy list 2>&1`).toString();
      expect(output).toContain('Available Strategies');
      expect(output).toContain('react');
    });

    test('explore --list-strategies should still work', () => {
      const output = execSync(`node ${CLI_PATH} explore --list-strategies 2>&1`).toString();
      expect(output).toContain('Available Strategies');
      expect(output).toContain('react');
    });

    test('strategy ls alias should list strategies', () => {
      const output = execSync(`node ${CLI_PATH} strategy ls 2>&1`).toString();
      expect(output).toContain('Available Strategies');
    });
  });
});
