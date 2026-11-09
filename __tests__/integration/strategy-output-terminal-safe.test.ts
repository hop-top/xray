/**
 * `strategy list|info|detect|path|validate` and `lang list` print strategy
 * names and paths through Logger.output, which cannot sanitize styled
 * text: each call site escapes repo-controlled fields itself. A project
 * strategy whose name carries ESC/BEL/C1, in a directory whose name carries
 * ESC, must put no raw control sequence on stdout or stderr. Requires
 * `npm run build`.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../bin/cli.js');
const NAME = 'ev\u001b[2Jil\u0007\u009bx';
// eslint-disable-next-line no-control-regex
const SGR = /\u001b\[[0-9;]*m/g;
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

let base: string;
let proj: string;
let env: NodeJS.ProcessEnv;

const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, '--no-telemetry', ...args], { cwd: proj, encoding: 'utf-8', env, timeout: 90_000 });

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-strat-safe-')));
  proj = path.join(base, 'dir\u001b[2Jwith-esc');
  fs.mkdirSync(path.join(proj, '.xray/strategies'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.xray/strategies/evil.yaml'),
    `name: "${NAME.replace('\u001b', '\\e').replace('\u0007', '\\a').replace('\u009b', '\\u009b')}"\nversion: "1.\\e[2J0"\ndetect:\n  files: ["*.zz"]\n  dependencies: []\nfileTypes: []\ntags: []\ncommands: {}\n`);
  fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"p"}');
  const home = path.join(base, 'home');
  env = {
    ...process.env, HOME: home, NO_COLOR: '1', XRAY_ALLOW_PROJECT_STRATEGIES: '1',
    XDG_CONFIG_HOME: path.join(home, 'c'), XDG_CACHE_HOME: path.join(home, 'k'),
    XDG_DATA_HOME: path.join(home, 'd'), XDG_STATE_HOME: path.join(home, 's'),
  };
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe('strategy and lang text output carries no raw control sequences', () => {
  it.each([
    ['strategy list', ['strategy', 'list']],
    ['strategy detect', ['strategy', 'detect']],
    ['strategy path', ['strategy', 'path']],
    ['lang list', ['lang', 'list']],
  ])('%s', (_n, args) => {
    const r = run(...args);
    expect(r.status).toBe(0);
    expect((r.stdout + r.stderr).replace(SGR, '')).not.toMatch(BAD);
  });

  it('strategy info and validate (by the odd name)', () => {
    for (const sub of ['info', 'validate']) {
      const r = run('strategy', sub, NAME);
      expect((r.stdout + r.stderr).replace(SGR, '')).not.toMatch(BAD);
    }
  });

  it('the strategy is really listed, with its name escaped', () => {
    const r = run('strategy', 'list');
    expect(r.stdout).toContain('\\x1b[2Jil');
  });

  it('strategy path shows the escaped directory', () => {
    expect(run('strategy', 'path').stdout).toContain('dir\\x1b[2Jwith-esc');
  });

  it('json output is unchanged: raw name as a JSON escape', () => {
    const r = run('strategy', 'list', '--format', 'json');
    expect(r.stdout).toContain('\\u001b[2Jil');
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});

describe('config strategy text: newlines in repo fields cannot forge lines', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-config-safe-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}');
    fs.writeFileSync(path.join(dir, 'c.config.json'), JSON.stringify({ 'k\nFORGED_KEY': 'v\nFORGED_VALUE' }));
    fs.writeFileSync(path.join(dir, 'app\nFORGED_FILE.config.json'), '{"a":1}');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const lines = (...args: string[]) => {
    const r = spawnSync(process.execPath, [CLI, '--no-telemetry', ...args], { cwd: dir, encoding: 'utf-8', env, timeout: 60000 });
    return r.stdout.split('\n');
  };

  it('config-files list: a filename stays on one line', () => {
    const out = lines('config-files', 'list');
    expect(out).toContain('  app\\nFORGED_FILE.config.json');
    for (const l of out) expect(l).not.toMatch(/^FORGED/);
  });

  it('config-files values: filename, key and value stay on one line', () => {
    const out = lines('config-files', 'values');
    expect(out).toContain('  k\\nFORGED_KEY = v\\nFORGED_VALUE');
    expect(out).toContain('app\\nFORGED_FILE.config.json:');
    for (const l of out) expect(l).not.toMatch(/^FORGED/);
  });
});
