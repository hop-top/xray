/**
 * Multi-root `map --format json`: one merged graph, namespaced ids, loadable
 * by `xray query --graph`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let work: string; // cwd for every run: contains roots `alpha/` and `beta/`
let outDir: string;

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: work,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
    timeout: 120_000,
  });
}

const base = (...roots: string[]) =>
  ['--skip-detect', ...roots.flatMap(r => ['-p', r])];

function mapTo(cmd: string, fmtArgs: string[], out: string, ...roots: string[]) {
  const r = run([cmd, ...base(...roots), ...fmtArgs, '-o', out]);
  expect(r.status).toBe(0);
  return r;
}

describe('multi-path JSON graph (map)', () => {
  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-gout-'));
    fs.mkdirSync(path.join(work, 'alpha'));
    fs.mkdirSync(path.join(work, 'beta'));
    // Same root-relative file name + function name in both roots => id collision
    // unless namespaced.
    fs.writeFileSync(
      path.join(work, 'alpha', 'main.ts'),
      "import { helper } from './util';\nexport function main() { helper(); other(); }\nfunction other() {}\n"
    );
    fs.writeFileSync(path.join(work, 'alpha', 'util.ts'), 'export function helper() { return 1; }\n');
    fs.writeFileSync(
      path.join(work, 'beta', 'main.ts'),
      'export function main() { run(); }\nfunction run() {}\n'
    );
  });
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-gout-out-'));
  });
  afterEach(() => fs.rmSync(outDir, { recursive: true, force: true }));
  afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

  describe('multi-path JSON is one merged graph', () => {
    test('union of roots, namespaced ids, roots recorded, nothing invented', () => {
      const out = path.join(outDir, 'merged.json');
      mapTo('map', ['--format', 'json'], out, 'alpha', 'beta');
      const one = path.join(outDir, 'alpha.json');
      mapTo('map', ['--format', 'json'], one, 'alpha');
      const two = path.join(outDir, 'beta.json');
      mapTo('map', ['--format', 'json'], two, 'beta');

      const merged = JSON.parse(fs.readFileSync(out, 'utf-8'));
      const a = JSON.parse(fs.readFileSync(one, 'utf-8'));
      const b = JSON.parse(fs.readFileSync(two, 'utf-8'));

      expect(merged.metadata.roots.map((r: any) => r.label)).toEqual(['alpha', 'beta']);
      for (const r of merged.metadata.roots) {
        expect(path.isAbsolute(r.path)).toBe(true);
        expect(path.basename(r.path)).toBe(r.label);
      }
      const ids: string[] = merged.nodes.map((n: any) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(expect.arrayContaining(['alpha/main.ts::main', 'beta/main.ts::main']));
      expect(merged.nodes).toHaveLength(a.nodes.length + b.nodes.length);
      expect(merged.edges).toHaveLength(a.edges.length + b.edges.length);
      expect(merged.metadata.nodeCount).toBe(merged.nodes.length);
      expect(merged.metadata.edgeCount).toBe(merged.edges.length);
      // every edge stays inside one root: no linking invented
      for (const e of merged.edges) {
        expect(e.source.split('/')[0]).toBe(e.target.split('/')[0]);
        expect(ids).toEqual(expect.arrayContaining([e.source, e.target]));
      }
    });

    test('--no-chunk gives the same merged graph', () => {
      const x = path.join(outDir, 'x.json');
      const y = path.join(outDir, 'y.json');
      mapTo('map', ['--format', 'json'], x, 'alpha', 'beta');
      mapTo('map', ['--format', 'json', '--no-chunk'], y, 'alpha', 'beta');
      const strip = (f: string) => {
        const g = JSON.parse(fs.readFileSync(f, 'utf-8'));
        delete g.metadata.timestamp;
        return g;
      };
      expect(strip(y)).toEqual(strip(x));
    });

    test('single root stays unprefixed with no roots metadata', () => {
      const out = path.join(outDir, 'single.json');
      mapTo('map', ['--format', 'json'], out, 'alpha');
      const g = JSON.parse(fs.readFileSync(out, 'utf-8'));
      expect(g.metadata.roots).toBeUndefined();
      expect(g.nodes.map((n: any) => n.id)).toContain('main.ts::main');
      // a repeated identical root is still a single root
      const dup = path.join(outDir, 'dup.json');
      mapTo('map', ['--format', 'json'], dup, 'alpha', './alpha');
      expect(JSON.parse(fs.readFileSync(dup, 'utf-8')).metadata.roots).toBeUndefined();
    });

    test('xray query --graph loads it and finds nodes from both roots', () => {
      const out = path.join(outDir, 'merged.json');
      mapTo('map', ['--format', 'json'], out, 'alpha', 'beta');

      // both `main`s match by label; their callees come from different roots
      const r = run(['query', '--graph', out, '--format', 'json', 'calls(main)']);
      expect(r.status).toBe(0);
      const res = JSON.parse(r.stdout);
      const names = res.nodes.map((n: any) => n.name).sort();
      expect(names).toEqual(['helper', 'other', 'run']);
      const roots = new Set(res.nodes.map((n: any) => n.id.split('/')[0]));
      expect(roots).toEqual(new Set(['alpha', 'beta']));

      // namespaced id addresses exactly one root
      const one = JSON.parse(
        run(['query', '--graph', out, '--format', 'json', 'calls(beta/main.ts::main)']).stdout
      );
      expect(one.nodes.map((n: any) => n.name)).toEqual(['run']);
    });
  });
});
