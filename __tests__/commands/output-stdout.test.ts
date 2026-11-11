/**
 * `-o -` sends the result to stdout as one document and writes no file:
 * text (unchunked), json, xml. csv is two tables and `--share` without a
 * path derives its name from the output path, so both are usage errors.
 * Built CLI in a subprocess, fresh temp project per case.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let sandbox: string;
let proj: string;

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: proj,
    encoding: 'utf-8',
    env: {
      ...process.env,
      XRAY_NO_TELEMETRY: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      XDG_CONFIG_HOME: path.join(sandbox, 'cfg'),
      XDG_DATA_HOME: path.join(sandbox, 'data'),
      XDG_CACHE_HOME: path.join(sandbox, 'cache'),
    },
    timeout: 90_000,
  });
}

const names = () => fs.readdirSync(proj).sort();

describe('-o - writes to stdout', () => {
  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-stdout-'));
    proj = path.join(sandbox, 'proj');
    fs.mkdirSync(proj);
    fs.writeFileSync(path.join(proj, 'a.ts'), 'export function alpha() { return 1; }\n');
  });
  afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  describe.each(['map', 'graph'])('%s', (cmd) => {
    it('text: one unchunked document on stdout, no file', () => {
      const r = run([cmd, '-o', '-']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('a.ts');
      expect(r.stdout).not.toMatch(/written to/);
      expect(names()).toEqual(['a.ts']);
    });

    it('json: stdout is the whole graph document, no file', () => {
      const r = run([cmd, '--format', 'json', '--output=-']);
      expect(r.status).toBe(0);
      const graph = JSON.parse(r.stdout);
      expect(Array.isArray(graph.nodes)).toBe(true);
      expect(names()).toEqual(['a.ts']);
    });

    it('xml: stdout is the graph document, no file', () => {
      const r = run([cmd, '--format', 'xml', '-o', '-']);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/<graph[\s>]/);
      expect(names()).toEqual(['a.ts']);
    });

    it('csv: usage error, nothing written', () => {
      const r = run([cmd, '--format', 'csv', '-o', '-']);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/csv/);
      expect(names()).toEqual(['a.ts']);
    });

    it('--share without a path: usage error, nothing written', () => {
      const r = run([cmd, '--share', '-o', '-']);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe('');
      expect(names()).toEqual(['a.ts']);
    });

    it('--share <path>: summary to the file, result on stdout', () => {
      const r = run([cmd, '--share', 'sum.md', '-o', '-']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('a.ts');
      expect(names()).toEqual(['a.ts', 'sum.md']);
    });
  });
});
