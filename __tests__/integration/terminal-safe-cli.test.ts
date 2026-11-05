/**
 * Repo-controlled text (file names, source lines, README headings) must
 * not reach a terminal with control sequences. A project with an ESC/OSC
 * file name, ESC in a source line and in a README heading is run through
 * each text-producing command; neither stdout, stderr nor the files map
 * writes may carry a raw ESC (xray's own SGR colors aside), BEL, CR or C1.
 * Requires `npm run build`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../bin/cli.js');
const EVIL = 'src/\u001b[2Jevil\u001b]0;pwned\u0007.ts';

let proj: string;
let home: string;
let env: NodeJS.ProcessEnv;

// eslint-disable-next-line no-control-regex
const SGR = /\u001b\[[0-9;]*m/g;
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

const run = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [CLI, '--no-telemetry', ...args], {
    cwd: proj, encoding: 'utf-8', timeout: 90_000, env: { ...env, ...extraEnv },
  });

/** Output with xray's own color sequences removed: nothing else control may remain. */
const residue = (s: string) => s.replace(SGR, '');

beforeAll(() => {
  proj = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-tsafe-proj-'));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-tsafe-home-'));
  env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'c'), XDG_CACHE_HOME: path.join(home, 'k'),
    XDG_DATA_HOME: path.join(home, 'd'), XDG_STATE_HOME: path.join(home, 's'),
    NO_COLOR: '1',
  };
  delete env.FORCE_COLOR;
  fs.mkdirSync(path.join(proj, 'src'));
  fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"p"}');
  const body = 'export function target() { return 1; }\nexport function caller() { return target(); }\n// \u001b[31mRED\u001b[0m in content\u0007\n';
  fs.writeFileSync(path.join(proj, EVIL), body);
  fs.writeFileSync(path.join(proj, 'src/a.ts'), body);
  fs.writeFileSync(path.join(proj, 'README.md'), '# Title \u001b[2Jheading\u0007\n\n## Sub \u009bx\n');
});

afterAll(() => {
  fs.rmSync(proj, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe('no control sequence from repo text reaches a terminal', () => {
  const graph = () => path.join(home, 'g.json');

  it.each([
    ['explore', ['explore']],
    ['explore --format table', ['explore', '--format', 'table']],
    ['explore --format csv', ['explore', '--format', 'csv']],
    ['explore --match', ['explore', '--match', '*.ts']],
    ['explore --search (content lines)', ['explore', '--search', 'RED']],
    ['explore --search --format table', ['explore', '--search', 'RED', '--format', 'table']],
    ['markdown toc', ['markdown', 'toc']],
    ['imports', ['imports']],
  ])('%s', (_n, args) => {
    const r = run(args);
    expect(r.status).toBe(0);
    expect(residue(r.stdout)).not.toMatch(BAD);
    expect(residue(r.stderr)).not.toMatch(BAD);
    expect(r.stdout + r.stderr).not.toContain('\u001b[2J');
  });

  it('map: stderr (ranked nodes) and the written map are clean', () => {
    const out = path.join(home, 'map.md');
    const r = run(['map', '--output', out, '--no-chunk']);
    expect(r.status).toBe(0);
    expect(residue(r.stderr)).not.toMatch(BAD);
    const written = fs.readFileSync(out, 'utf-8');
    expect(written).not.toMatch(BAD);
    expect(written).toContain('\\x1b[2Jevil');
  });

  it('map --format json then query and impact text', () => {
    expect(run(['map', '--format', 'json', '--output', graph()]).status).toBe(0);
    const q = run(['query', '--graph', graph(), 'callers(target)']);
    expect(q.status).toBe(0);
    expect(residue(q.stdout + q.stderr)).not.toMatch(BAD);
    expect(q.stdout).toContain('\\x1b[2Jevil');
    for (const fmt of ['text', 'brief', 'tree']) {
      const i = run(['impact', 'target', '--graph', graph(), '--format', fmt]);
      expect(i.status).toBe(0);
      expect(residue(i.stdout + i.stderr)).not.toMatch(BAD);
    }
  });

  it('JSON output is untouched: the raw name survives as a JSON escape', () => {
    const r = run(['explore', '--format', 'json']);
    expect(r.stdout).toContain('\\u001b[2Jevil\\u001b]0;pwned\\u0007');
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('escaped text shows what the name was', () => {
    const r = run(['explore']);
    expect(r.stdout).toContain('evil');
    expect(r.stdout).toContain('\\x1b[2J');
  });

  it('xray\'s own colors survive when forced on', () => {
    const r = run(['explore', '--search', 'RED'], { FORCE_COLOR: '1', NO_COLOR: undefined });
    expect(r.stdout + r.stderr).toMatch(SGR);
    expect(residue(r.stdout + r.stderr)).not.toMatch(BAD);
  });
});
