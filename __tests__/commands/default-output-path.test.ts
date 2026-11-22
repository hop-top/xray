/**
 * Without -o, every generated output lands under `$PWD/.xray/<kind>/`:
 *   - `map`   -> `.xray/maps/map*`   (`map_root.md`, `map.txt`, `map.json`, `map.xml`, `map.mmd`, `map.{nodes,edges}.csv`, `map.share.md`)
 *   - `graph` -> `.xray/graphs/graph*` (`graph_root.md`, `graph.txt`, `graph.json`, `graph.xml`, `graph.mmd`, `graph.share.md`)
 * No `.xray.*` or `.xray_*` dotfiles are written directly into `$PWD`.
 * Built CLI in a subprocess, fresh temp project per case.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileScanner } from '../../src/lib/scanner';

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

const rootNames = () => fs.readdirSync(proj);
const rootDotfiles = () => rootNames().filter(n => n.startsWith('.xray.') || n.startsWith('.xray_'));

describe('default output path (no -o)', () => {
  beforeEach(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-defout-')));
    proj = path.join(sandbox, 'proj');
    fs.mkdirSync(proj);
    fs.writeFileSync(path.join(proj, 'a.ts'), 'export function a() { return 1; }\n');
  });
  afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const cmds: Array<['map' | 'graph', 'maps' | 'graphs']> = [
    ['map', 'maps'],
    ['graph', 'graphs'],
  ];

  describe.each(cmds)('%s', (cmd, subdir) => {
    it.each([
      ['json', `${cmd}.json`],
      ['xml', `${cmd}.xml`],
      ['mermaid', `${cmd}.mmd`],
    ])('--format %s writes .xray/%s/%s and leaves no root .xray* dotfiles', (format, file) => {
      const r = run([cmd, '--format', format]);
      expect(r.stderr).not.toMatch(/FileWriteError/);
      expect(r.status).toBe(0);
      expect(rootDotfiles()).toEqual([]);
      expect(fs.existsSync(path.join(proj, '.xray', 'detected-strategies.json'))).toBe(false);
      const outPath = path.join(proj, '.xray', subdir, file);
      const body = fs.readFileSync(outPath, 'utf-8');
      if (format === 'json') {
        const g = JSON.parse(body);
        expect(Array.isArray(g.nodes)).toBe(true);
        expect(Array.isArray(g.edges)).toBe(true);
      } else if (format === 'xml') {
        expect(body).toMatch(/^<\?xml|^<graph|<node/m);
      } else {
        expect(body).toMatch(/^flowchart LR\n/);
      }
    });

    it('--format csv writes .xray/maps/map.{nodes,edges}.csv (graph: usage error, flow has no csv form)', () => {
      const r = run([cmd, '--format', 'csv']);
      if (cmd === 'graph') {
        expect(r.status).toBe(2);
        expect(rootNames().filter(n => n.startsWith('.xray'))).toEqual([]);
        return;
      }
      expect(r.status).toBe(0);
      expect(rootDotfiles()).toEqual([]);
      expect(fs.readdirSync(path.join(proj, '.xray', subdir))).toEqual(
        expect.arrayContaining([`${cmd}.nodes.csv`, `${cmd}.edges.csv`])
      );
    });

    it(`--skip-detect --format json writes .xray/${subdir}/${cmd}.json and no root dotfiles`, () => {
      const r = run([cmd, '--skip-detect', '--format', 'json']);
      expect(r.status).toBe(0);
      expect(rootDotfiles()).toEqual([]);
      JSON.parse(fs.readFileSync(path.join(proj, '.xray', subdir, `${cmd}.json`), 'utf-8'));
    });

    it(`--no-chunk (text) writes .xray/${subdir}/${cmd}.txt and leaves no root dotfiles`, () => {
      const r = run([cmd, '--no-chunk']);
      expect(r.stderr).not.toMatch(/FileWriteError/);
      expect(r.status).toBe(0);
      expect(rootDotfiles()).toEqual([]);
      expect(fs.readFileSync(path.join(proj, '.xray', subdir, `${cmd}.txt`), 'utf-8')).toContain('a.ts');
    });

    it(`chunked text default writes .xray/${subdir}/${cmd}_root.md`, () => {
      const r = run([cmd]);
      expect(r.status).toBe(0);
      expect(rootDotfiles()).toEqual([]);
      expect(fs.readdirSync(path.join(proj, '.xray', subdir))).toContain(`${cmd}_root.md`);
    });

    it(`--share defaults into .xray/${subdir}/${cmd}.share.md`, () => {
      const r = run([cmd, '--share', '--no-chunk']);
      expect(r.status).toBe(0);
      expect(rootDotfiles()).toEqual([]);
      expect(fs.existsSync(path.join(proj, '.xray', subdir, `${cmd}.share.md`))).toBe(true);
    });
  });

  it('map and graph coexist under .xray/{maps,graphs}/ without clobbering each other', () => {
    expect(run(['map', '--format', 'json']).status).toBe(0);
    expect(run(['map']).status).toBe(0);
    expect(run(['graph', '--format', 'json']).status).toBe(0);
    expect(run(['graph']).status).toBe(0);
    expect(rootDotfiles()).toEqual([]);
    expect(fs.readdirSync(path.join(proj, '.xray', 'maps'))).toEqual(
      expect.arrayContaining(['map.json', 'map_root.md'])
    );
    expect(fs.readdirSync(path.join(proj, '.xray', 'graphs'))).toEqual(
      expect.arrayContaining(['graph.json', 'graph_root.md'])
    );
  });

  it('refuses default write when .xray is a symlink escaping the project (exit 2)', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-escape-'));
    try {
      fs.symlinkSync(outside, path.join(proj, '.xray'));
      const r = run(['map', '--format', 'json']);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/refusing to write|outside the project/i);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('fails cleanly with FileWriteError when a regular file .xray blocks directory creation', () => {
    fs.writeFileSync(path.join(proj, '.xray'), 'stale file\n');
    const r = run(['map', '--format', 'json']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/FileWriteError|EEXIST|ENOTDIR|Failed to write/i);
  });

  it('FileScanner ignores .xray/ in non-git projects', () => {
    fs.mkdirSync(path.join(proj, '.xray', 'maps'), { recursive: true });
    fs.mkdirSync(path.join(proj, '.xray', 'strategies'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.xray', 'maps', 'map_root.md'), '# map\n');
    fs.writeFileSync(path.join(proj, '.xray', 'strategies', 'custom.ts'), 'export const x = 1;\n');
    const files = new FileScanner(proj).scan();
    expect(files).toEqual(['a.ts']);
  });

  it('explicit -o is untouched', () => {
    const r = run(['map', '--format', 'json', '-o', 'out.json']);
    expect(r.status).toBe(0);
    expect(rootNames()).toContain('out.json');
  });
});
