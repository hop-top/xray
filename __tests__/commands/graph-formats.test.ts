/**
 * CSV / XML renderers for map / graph: node/edge counts equal the JSON
 * graph's; outputs parse with real parsers and are deterministic.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { DOMParser } from '@xmldom/xmldom';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let work: string; // cwd for every run: contains roots `alpha/` and `beta/`
let outDir: string;

const parseCsv = (file: string): any[] =>
  parse(fs.readFileSync(file, 'utf-8'), { columns: true }) as any[];

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

function xmlDoc(file: string) {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level: string, msg: string) => { if (level !== 'warning') errors.push(msg); },
  }).parseFromString(fs.readFileSync(file, 'utf-8'), 'text/xml');
  expect(errors).toEqual([]);
  return doc;
}

describe('graph outputs (map / graph)', () => {
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

  describe.each(['map', 'graph'])('%s --format csv / xml', cmd => {
    test('csv: nodes + edges tables with the JSON graph\'s counts', () => {
      if (cmd === 'graph') {
        // graph carries control/data flow, which csv has no form for.
        const r = run([cmd, ...base('alpha'), '--format', 'csv', '-o', path.join(outDir, 'g')]);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('no csv form');
        expect(fs.readdirSync(outDir)).toEqual([]);
        return;
      }
      const json = path.join(outDir, 'g.json');
      mapTo(cmd, ['--format', 'json'], json, 'alpha', 'beta');
      const g = JSON.parse(fs.readFileSync(json, 'utf-8'));

      mapTo(cmd, ['--format', 'csv'], path.join(outDir, 'g'), 'alpha', 'beta');
      expect(fs.readdirSync(outDir).sort()).toEqual(['g.edges.csv', 'g.json', 'g.nodes.csv']);
      const nodes = parseCsv(path.join(outDir, 'g.nodes.csv'));
      const edges = parseCsv(path.join(outDir, 'g.edges.csv'));
      expect(nodes).toHaveLength(g.nodes.length);
      expect(edges).toHaveLength(g.edges.length);
      expect(nodes.map(n => n.id)).toEqual(g.nodes.map((n: any) => n.id).sort());
      expect(nodes.find(n => n.id === 'beta/main.ts::main').root).toBe('beta');
      const key = (e: any) => `${e.source}|${e.target}|${e.type}`;
      expect(edges.map(key).sort()).toEqual(g.edges.map(key).sort());
    });

    test('xml: one well-formed <graph> with the JSON graph\'s counts', () => {
      const json = path.join(outDir, 'g.json');
      mapTo(cmd, ['--format', 'json'], json, 'alpha', 'beta');
      const g = JSON.parse(fs.readFileSync(json, 'utf-8'));

      const xml = path.join(outDir, 'g.xml');
      mapTo(cmd, ['--format', 'xml'], xml, 'alpha', 'beta');
      const doc = xmlDoc(xml);
      expect(doc.documentElement?.tagName).toBe('graph');
      const nodes = Array.from(doc.getElementsByTagName('node'));
      const edges = Array.from(doc.getElementsByTagName('edge'));
      expect(nodes).toHaveLength(g.nodes.length);
      expect(edges).toHaveLength(g.edges.length);
      expect(nodes.map(n => n.getAttribute('id'))).toEqual(g.nodes.map((n: any) => n.id).sort());
      expect(doc.getElementsByTagName('root')).toHaveLength(2);
    });
  });

  test('legacy --csv / --xml flags use the real renderers', () => {
    mapTo('map', ['--csv'], path.join(outDir, 'l'), 'alpha');
    expect(parseCsv(path.join(outDir, 'l.nodes.csv')).length).toBeGreaterThan(0);
    mapTo('map', ['--xml'], path.join(outDir, 'l'), 'alpha');
    expect(xmlDoc(path.join(outDir, 'l.xml')).documentElement?.tagName).toBe('graph');
  });

  test('csv output name: explicit .csv extension is not doubled; --no-chunk same', () => {
    mapTo('map', ['--format', 'csv', '--no-chunk'], path.join(outDir, 'out.csv'), 'alpha');
    expect(fs.readdirSync(outDir).sort()).toEqual(['out.edges.csv', 'out.nodes.csv']);
  });

  test('output is deterministic (identical bytes across runs, xml/csv)', () => {
    const read = (d: string, f: string) => fs.readFileSync(path.join(d, f), 'utf-8');
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-gout-out2-'));
    try {
      for (const d of [outDir, other]) mapTo('map', ['--format', 'csv'], path.join(d, 'g'), 'alpha', 'beta');
      expect(read(other, 'g.nodes.csv')).toBe(read(outDir, 'g.nodes.csv'));
      expect(read(other, 'g.edges.csv')).toBe(read(outDir, 'g.edges.csv'));
      for (const d of [outDir, other]) mapTo('map', ['--format', 'xml'], path.join(d, 'g.xml'), 'alpha', 'beta');
      const noTs = (s: string) => s.replace(/timestamp="[^"]*"/, '');
      expect(noTs(read(other, 'g.xml'))).toBe(noTs(read(outDir, 'g.xml')));
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
