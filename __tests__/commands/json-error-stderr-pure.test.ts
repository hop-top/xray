/**
 * Under `--format json` a failing leaf writes the error envelope and
 * nothing else of its own making: human help (strategy lists, examples,
 * alias warnings) is not printed. What it says that is useful rides in the
 * envelope's `alternatives` / `suggested_fix`. Text mode keeps the help.
 * Unlike json-errors.test.ts this runs WITHOUT --quiet: ordinary logs may
 * precede an envelope, so only the help lines are asserted absent.
 * Spawns the built CLI (`npm run build` first).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../..', 'dist', 'index.js');

interface Envelope { code: string; message: string; exit_code: number; alternatives?: string[]; suggested_fix?: string }

describe('JSON failures carry help in the envelope, not on stderr', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  let proj: string;

  const sub = (...p: string[]) => {
    const d = path.join(root, ...p);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', ...args], { cwd: proj, env, encoding: 'utf8', timeout: 60_000 });

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'json-pure-'));
    proj = sub('proj');
    fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'p' }));
    fs.writeFileSync(path.join(proj, '.xrayrc.json'), JSON.stringify({ aliases: { zz: 'nopestrat cmd' } }));
    env = {
      ...process.env,
      HOME: sub('env', 'home'),
      XDG_CONFIG_HOME: sub('env', 'config'),
      XDG_CACHE_HOME: sub('env', 'cache'),
      XDG_STATE_HOME: sub('env', 'state'),
      XDG_DATA_HOME: sub('env', 'data'),
      NO_COLOR: '1',
      XRAY_NO_TELEMETRY: '1',
    };
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('strategy info <unknown>: stderr is the envelope; names are alternatives', () => {
    const r = run('strategy', 'info', 'nope', '--format', 'json');
    expect(r.status).toBe(3);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toMatch(/Available strategies|Alias validation/);
    const e = JSON.parse(r.stderr) as Envelope;
    expect(e.code).toBe('NOT_FOUND');
    expect(e.alternatives).toEqual(expect.arrayContaining(['react', 'build']));
  });

  it('strategy info <unknown> in text mode still lists the strategies', () => {
    const r = run('strategy', 'info', 'nope');
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/Available strategies/);
    expect(r.stderr).toMatch(/- react/);
  });

  it('failing alias validation prints no warnings in JSON mode; an unknown alias says why', () => {
    const r = run('zz', '--format', 'json');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toMatch(/Alias validation/);
    const e = JSON.parse(r.stderr) as Envelope;
    expect(e.code).toBe('USAGE');
    expect(e.suggested_fix).toMatch(/Alias "zz" targets unknown strategy "nopestrat"/);
  });

  it('alias validation warnings stay in text mode', () => {
    const r = run('zz');
    expect(r.stderr).toMatch(/Alias validation errors/);
  });

  it('alias set <bad target>: example is suggested_fix, not a stderr line', () => {
    const r = run('alias', 'set', 'q', 'oneword', '--format', 'json');
    expect(r.status).toBe(2);
    expect(r.stderr).not.toMatch(/^ℹ Example/m);
    const e = JSON.parse(r.stderr) as Envelope;
    expect(e.suggested_fix).toMatch(/xray alias set comp "react components"/);
    expect(run('alias', 'set', 'q', 'oneword').stderr).toMatch(/Example: xray alias set comp/);
  });
});
