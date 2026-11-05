/**
 * Without -o, every output format must land at a path that does not collide
 * with a `.xray/` directory, which `strategy detect` and project strategies use:
 * graph formats write `.xray.<ext>` (csv: `.xray.{nodes,edges}.csv`), a
 * single-file text map writes `.xray.txt`, chunked text keeps `.xray_*.md`.
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

const names = () => fs.readdirSync(proj);
const noFileAt = (p: string) => !fs.existsSync(path.join(proj, p)) || fs.statSync(path.join(proj, p)).isDirectory();

describe('default output path (no -o)', () => {
  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-defout-'));
    proj = path.join(sandbox, 'proj');
    fs.mkdirSync(proj);
    fs.writeFileSync(path.join(proj, 'a.ts'), 'export function a() { return 1; }\n');
  });
  afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const cmds = ['map', 'graph'];

  describe.each(cmds)('%s', (cmd) => {
    it.each([
      ['json', '.xray.json'],
      ['xml', '.xray.xml'],
    ])('--format %s writes %s and leaves no .xray file', (format, file) => {
      const r = run([cmd, '--format', format]);
      expect(r.stderr).not.toMatch(/FileWriteError/);
      expect(r.status).toBe(0);
      expect(noFileAt('.xray')).toBe(true);
      expect(fs.existsSync(path.join(proj, '.xray', 'detected-strategies.json'))).toBe(false);
      const body = fs.readFileSync(path.join(proj, file), 'utf-8');
      if (format === 'json') {
        const g = JSON.parse(body);
        expect(Array.isArray(g.nodes)).toBe(true);
        expect(Array.isArray(g.edges)).toBe(true);
      } else {
        expect(body).toMatch(/^<\?xml|^<graph|<node/m);
      }
    });

    it('--format csv writes .xray.nodes.csv and .xray.edges.csv (graph: usage error, flow has no csv form)', () => {
      const r = run([cmd, '--format', 'csv']);
      if (cmd === 'graph') {
        expect(r.status).toBe(2);
        expect(names().filter(n => n.startsWith('.xray'))).toEqual([]);
        return;
      }
      expect(r.status).toBe(0);
      expect(noFileAt('.xray')).toBe(true);
      expect(names()).toEqual(expect.arrayContaining(['.xray.nodes.csv', '.xray.edges.csv']));
    });

    it('--skip-detect --format json writes .xray.json and no .xray file', () => {
      const r = run([cmd, '--skip-detect', '--format', 'json']);
      expect(r.status).toBe(0);
      expect(names()).toContain('.xray.json');
      expect(names()).not.toContain('.xray');
      JSON.parse(fs.readFileSync(path.join(proj, '.xray.json'), 'utf-8'));
    });
  });

  it('map --format json then default text map: both succeed side by side', () => {
    expect(run(['map', '--format', 'json']).status).toBe(0);
    expect(run(['map']).status).toBe(0);
    expect(noFileAt('.xray')).toBe(true);
    expect(names()).toEqual(expect.arrayContaining(['.xray.json', '.xray_root.md']));
  });

  it('map --no-chunk (text) writes .xray.txt and leaves no .xray file', () => {
    const r = run(['map', '--no-chunk']);
    expect(r.stderr).not.toMatch(/FileWriteError/);
    expect(r.status).toBe(0);
    expect(noFileAt('.xray')).toBe(true);
    expect(fs.readFileSync(path.join(proj, '.xray.txt'), 'utf-8')).toContain('a.ts');
  });

  it('map (chunked text default) still writes .xray_root.md', () => {
    const r = run(['map']);
    expect(r.status).toBe(0);
    expect(names()).toContain('.xray_root.md');
    expect(noFileAt('.xray')).toBe(true);
  });

  it('explicit -o is untouched', () => {
    const r = run(['map', '--format', 'json', '-o', 'out.json']);
    expect(r.status).toBe(0);
    expect(names()).toContain('out.json');
  });
});
