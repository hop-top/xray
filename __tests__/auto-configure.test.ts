import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const CLI_PATH = path.join(__dirname, '../bin/xray');


/**
 * Run the CLI and return stdout plus, for `--no-chunk` runs, the content of
 * the single output file. Single-file mode writes the analysis to a file (not
 * stdout), and the default `.xray` target collides with the `.xray/` state
 * dir that strategy detection creates, so each run uses an explicit file.
 */
function runCli(args: string, cwd: string): string {
  const withOut = args.includes('--no-chunk') ? `${args} -o out.txt` : args;
  const stdout = execSync(`node ${CLI_PATH} ${withOut} 2>&1`, {
    encoding: 'utf-8',
    timeout: 30000,
    cwd,
  });
  const outFile = path.join(cwd, 'out.txt');
  return fs.existsSync(outFile) ? stdout + fs.readFileSync(outFile, 'utf-8') : stdout;
}

describe('Auto-Configure Feature E2E', () => {
  let testRoot: string;
  let reactProject: string;

  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      execSync('npm run build', { stdio: 'inherit' });
    }
  });

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-auto-configure-test-'));
    reactProject = path.join(testRoot, 'react-app');
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

    fs.mkdirSync(path.join(reactProject, 'src'), { recursive: true });
    fs.mkdirSync(path.join(reactProject, '__tests__'), { recursive: true });

    fs.writeFileSync(
      path.join(reactProject, 'src', 'App.tsx'),
      `import React from 'react';

export function App() {
  return <div>Hello</div>;
}
`
    );

    fs.writeFileSync(
      path.join(reactProject, 'src', 'index.ts'),
      `export { App } from './App';
`
    );

    fs.writeFileSync(
      path.join(reactProject, 'src', 'App.test.tsx'),
      `import React from 'react';
import { render } from '@testing-library/react';
import { App } from './App';

test('renders app', () => {
  render(<App />);
});
`
    );
  });

  afterEach(() => {
    if (testRoot && fs.existsSync(testRoot)) {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe('map command with auto-configure', () => {
    test('should detect strategies and auto-configure paths (default)', () => {
      const output = runCli(`map --no-chunk --depth 1`, reactProject);

      expect(output).toMatch(/Detected strategies: .*\breact\b/);
      expect(output).toContain('Auto-configured paths from detected strategies');
    });

    test('should not auto-configure when path is explicitly provided', () => {
      const output = runCli(`map -p ${reactProject} --no-chunk --depth 1`, testRoot);

      expect(output).not.toContain('Detected strategies:');
      expect(output).not.toContain('Auto-configured paths');
    });

    test('should auto-configure with --detect even when path is provided', () => {
      const output = runCli(`map -p ${reactProject} --no-chunk --detect --depth 1`, testRoot);

      expect(output).toMatch(/Detected strategies: .*\breact\b/);
      expect(output).toContain('Auto-configured paths from detected strategies');
    });

    test('should include react file types in match patterns', () => {
      const output = runCli(`map --no-chunk --depth 1`, reactProject);

      expect(output).toMatch(/Detected strategies: .*\breact\b/);
      expect(output).toContain('Auto-configured paths from detected strategies');
      expect(output).toContain('App.tsx');
    });

    test('should filter based on strategy file types', () => {
      const output = runCli(`map --no-chunk --depth 1`, reactProject);

      expect(output).toMatch(/Detected strategies: .*\breact\b/);
      expect(output).toContain('Auto-configured paths from detected strategies');
      expect(output).toContain('App.tsx');
    });

    test('should not auto-configure with --skip-detect', () => {
      const output = runCli(`map --no-chunk --skip-detect --depth 1`, reactProject);

      expect(output).not.toContain('Detected strategies:');
      expect(output).not.toContain('Auto-configured paths');
    });

    test('should work with graph command', () => {
      const output = runCli(`graph --no-chunk`, reactProject);

      expect(output).toMatch(/Detected strategies: .*\breact\b/);
      expect(output).toContain('Auto-configured paths from detected strategies');
    });

    test('an explicit --match is the only file filter; detected file types are not added', () => {
      const output = runCli(`map --no-chunk -m "*.json" --depth 1`, reactProject);

      expect(output).toMatch(/Detected strategies: .*\breact\b/);
      expect(output).not.toContain('App.tsx');
    });

    test('should not duplicate existing match patterns', () => {
      const output = runCli(`map --no-chunk -m "*.tsx" --depth 1`, reactProject);

      expect(output).toMatch(/Detected strategies: .*\breact\b/);
      expect(output).toContain('Auto-configured paths from detected strategies');
      expect(output).toContain('App.tsx');
    });

    test('should handle projects with no detected strategies', () => {
      const plainProject = path.join(testRoot, 'plain-app');
      fs.mkdirSync(plainProject, { recursive: true });
      fs.writeFileSync(
        path.join(plainProject, 'package.json'),
        JSON.stringify({ name: 'plain-app', dependencies: {} }, null, 2)
      );
      fs.writeFileSync(
        path.join(plainProject, 'index.js'),
        'console.log("hello");'
      );

      const output = runCli(`map --no-chunk --depth 1`, plainProject);

      // Generic strategies (build, package-manager; 0be2d19) match any
      // package.json, so assert only that no framework strategy is detected.
      expect(output).not.toMatch(/Detected strategies: .*\breact\b/);
    });

    test('should be configurable via config file', () => {
      const configPath = path.join(reactProject, 'xray.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ skipDetect: true }, null, 2));

      const output = runCli(`map --no-chunk --depth 1`, reactProject);

      expect(output).not.toContain('Detected strategies:');
      expect(output).not.toContain('Auto-configured paths');
    });

    test('should show help with skip-detect option', () => {
      const output = execSync(`node ${CLI_PATH} map --help`).toString();
      expect(output).toContain('--skip-detect');
    });

    test('should work with map command', () => {
      const output = runCli(`map --no-chunk --depth 1`, reactProject);

      expect(output).toMatch(/Detected strategies: .*\breact\b/);
      expect(output).toContain('Auto-configured paths from detected strategies');
    });
  });

  afterAll(() => {
    if (fs.existsSync(path.join(process.cwd(), '.xray'))) {
      fs.rmSync(path.join(process.cwd(), '.xray'), { recursive: true, force: true });
    }
  });
});
