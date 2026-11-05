/**
 * Strategy code living in the project (`.xray/strategies/*.js|ts`,
 * `node_modules/xray-strategy-*`, bare `node_modules/*.js`) runs only when
 * the user sets XRAY_ALLOW_PROJECT_STRATEGIES=1. Built-in and declarative
 * YAML strategies need nothing. Every case spawns the built CLI
 * (`npm run build` first) against strategy files that write a marker at
 * import time; off by default means no marker.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');
const VAR = 'XRAY_ALLOW_PROJECT_STRATEGIES';

let tmp: string;
let home: string;
let repo: string;
let other: string;
let marks: string;

function write(file: string, content: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/** A code strategy: marker at import time, `go` command marker when run. */
const strategy = (id: string, name: string) =>
  `require('fs').writeFileSync(${JSON.stringify(path.join(tmp, 'marks', id))}, 'x');\n` +
  `module.exports = { name: '${name}', version: '1.0.0', detect: () => false,\n` +
  `  analyze: async () => ({ tags: [] }),\n` +
  `  commands: { go: { description: 'go', handler: async () => {\n` +
  `    require('fs').writeFileSync(${JSON.stringify(path.join(tmp, 'marks', id + '-handler'))}, 'x'); return {}; } } } };\n`;

const VECTORS: Array<[string, string, string]> = [
  // id, file, strategy name
  ['xray-js', '.xray/strategies/vecxrayjs.js', 'vecxrayjs'],
  ['xray-ts', '.xray/strategies/vecxrayts.ts', 'vecxrayts'],
  ['nm-pkg', 'node_modules/xray-strategy-vec/index.js', 'vecnmpkg'],
  ['nm-direct', 'node_modules/vecdirect.js', 'vecnmdirect'],
];

/** `bare`: argv exactly as a shell invokes completion (`xray __complete ...`). */
function run(args: string[], cwd: string, env: Record<string, string | undefined> = {}, bare = false) {
  return spawnSync(process.execPath, [ENTRY, ...(bare ? [] : ['--no-telemetry', '--offline']), ...args], {
    cwd,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      NO_COLOR: '1',
      ...env,
    },
    input: '',
    encoding: 'utf-8',
    timeout: 60_000,
  });
}

const ran = () => fs.readdirSync(marks).sort();

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-optin-')));
  home = path.join(tmp, 'home');
  repo = path.join(tmp, 'repo');
  other = path.join(tmp, 'other');
  marks = path.join(tmp, 'marks');
  for (const d of [home, other, marks]) fs.mkdirSync(d, { recursive: true });
  write(path.join(repo, 'a.py'), 'def a():\n    return 1\n');
  write(path.join(repo, 'b.js'), 'function f() { return 1; }\n');
  for (const [id, file, name] of VECTORS) write(path.join(repo, file), strategy(id, name));
  write(
    path.join(repo, 'node_modules/xray-strategy-vec/package.json'),
    JSON.stringify({ name: 'xray-strategy-vec', 'xray-strategy': { name: 'vecnmpkg', entry: 'index.js' } })
  );
  write(
    path.join(repo, '.xray/strategies/decl.yml'),
    'name: declyaml\nversion: 2.0.0\ndetect:\n  files: ["*.py"]\nfileTypes: [".py"]\ntags: []\n'
  );
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('off by default', () => {
  it.each([
    ['--version', ['--version']],
    ['--help', ['--help']],
    ['map', ['map', '-o', 'out']],
    ['imports', ['imports']],
    ['describe', ['describe']],
    ['strategy list', ['strategy', 'list']],
    ['strategy detect', ['strategy', 'detect']],
    ['strategy path', ['strategy', 'path']],
    ['mcp (stdin closed)', ['mcp']],
  ])('%s from inside the repo runs no project code', (_label, args) => {
    run(args, repo);
    expect(ran()).toEqual([]);
  });

  it('-C repo runs no project code', () => {
    run(['-C', repo, 'map', '-o', 'out'], other);
    run(['-C', repo, 'strategy', 'list'], other);
    expect(ran()).toEqual([]);
  });

  it('-p from elsewhere runs no project code', () => {
    run(['map', '-p', repo, '-o', 'out'], other);
    run(['imports', '-p', repo], other);
    expect(ran()).toEqual([]);
  });

  it('shell completion runs no project code', () => {
    run(['__complete', 'map', ''], repo, {}, true);
    run(['__complete', 'strategy', 'info', ''], repo, {}, true);
    expect(ran()).toEqual([]);
  });

  it('a strategy command is not run', () => {
    run(['vecxrayjs', 'go'], repo);
    expect(ran()).toEqual([]);
  });

  it.each(['0', 'true', 'yes', ''])('%j does not enable it; only 1 does', (value) => {
    run(['strategy', 'list'], repo, { [VAR]: value });
    expect(ran()).toEqual([]);
  });

  it('built-in and declarative YAML strategies still load', () => {
    const r = run(['strategy', 'list'], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('declyaml');
    expect(r.stdout).toMatch(/react|markdown|config/);
    expect(r.stdout).not.toContain('vec');
  });

  it.each([
    [
      'a !!js/function tag',
      (m: string) =>
        `name: tagged\nversion: 1.0.0\ndetect: !!js/function >\n  function () { require('fs').writeFileSync(${JSON.stringify(m)}, 'x'); return {}; }\n`,
    ],
    [
      'run, extends and string handler keys',
      (m: string) =>
        `name: runkey\nversion: 1.0.0\ndetect:\n  files: ["*.py"]\nrun: "touch ${m}"\nextends: ./vecdirect.js\ncommands:\n  go:\n    description: go\n    handler: "touch ${m}"\n`,
    ],
  ])('YAML with %s runs no code, even with the variable', (_label, yml) => {
    const m = path.join(marks, 'yaml');
    write(path.join(repo, '.xray/strategies/hostile.yml'), yml(m));
    for (const env of [{}, { [VAR]: '1' }]) {
      run(['strategy', 'detect'], repo, env);
      run(['strategy', 'list'], repo, env);
      run(['runkey', 'go'], repo, env);
      run(['map', '-o', 'out'], repo, env);
    }
    expect(ran().filter((x) => x.startsWith('yaml'))).toEqual([]);
  });
});

describe('only YAML counts as declarative', () => {
  test.each(['index.cjs', 'index.mjs', 'index.JS', 'index'])('package entry %s is skipped as code, never handed to the loader', entry => {
    write(path.join(repo, 'node_modules/xray-strategy-other', entry), strategy('other', 'vecother'));
    write(
      path.join(repo, 'node_modules/xray-strategy-other/package.json'),
      JSON.stringify({ name: 'xray-strategy-other', 'xray-strategy': { name: 'vecother', entry } }),
    );
    const r = run(['strategy', 'list'], repo);
    const out = r.stdout + r.stderr;
    expect(out).toContain('node_modules/xray-strategy-other');
    expect(out).not.toContain('Failed to load strategy');
    expect(ran()).toEqual([]);
  });
});

describe('what the user is told', () => {
  const names = ['.xray/strategies/vecxrayjs.js', '.xray/strategies/vecxrayts.ts', 'node_modules/xray-strategy-vec', 'node_modules/vecdirect.js'];

  it.each([
    ['strategy list', ['strategy', 'list']],
    ['strategy detect', ['strategy', 'detect']],
    ['strategy info <name>', ['strategy', 'info', 'vecxrayjs']],
    ['strategy validate <name>', ['strategy', 'validate', 'vecxrayjs']],
    ['strategy path', ['strategy', 'path']],
    ['a named strategy command', ['vecxrayjs', 'go']],
  ])('%s names what was skipped and the variable', (_label, args) => {
    const r = run(args, repo);
    for (const n of names) expect(r.stderr).toContain(n);
    expect(r.stderr).toContain(`${VAR}=1`);
    expect(r.stderr).toContain('not loaded');
  });

  describe('a bare query word', () => {
    it.each([['foo'], ['calls(main)']])('%s is not a strategy command: no notice', (word) => {
      const r = run([word], repo);
      expect(r.stderr).not.toContain(VAR);
    });

    it.each([
      ['a skipped file name', 'vecxrayjs'],
      ['a skipped file name with a different extension', 'vecxrayts'],
      ['a skipped package directory suffix', 'vec'],
      ['a skipped package name', 'vecnmpkg'],
      ['a skipped bare node_modules file', 'vecdirect'],
    ])('%s gets the notice', (_label, word) => {
      const r = run([word], repo);
      expect(r.stderr).toContain(`${VAR}=1`);
      expect(ran()).toEqual([]);
    });

    it('a two-word form gets the notice even when the word matches no file name', () => {
      const r = run(['zz', 'go'], repo);
      expect(r.stderr).toContain(`${VAR}=1`);
    });
  });

  it('a skipped strategy named in strategy info fails, with the hint', () => {
    const r = run(['strategy', 'info', 'vecxrayjs'], repo);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`${VAR}=1`);
  });

  it.each([
    ['map', ['map', '-o', 'out']],
    ['imports', ['imports']],
    ['describe', ['describe']],
    ['--version', ['--version']],
    ['-p from elsewhere', ['map', '-p', '__REPO__', '-o', 'out']],
  ])('%s stays quiet at the default level', (_label, args) => {
    const cwd = args.includes('__REPO__') ? other : repo;
    const r = run(args.map((a) => (a === '__REPO__' ? repo : a)), cwd);
    expect(r.stderr).not.toContain(VAR);
    expect(r.stdout).not.toContain(VAR);
  });

  it('map notes it at debug level', () => {
    const r = run(['--log-level', 'debug', 'map', '-o', 'out'], repo);
    expect(r.stderr).toContain(`${VAR}=1`);
    expect(r.stderr).toContain('.xray/strategies/vecxrayjs.js');
  });

  it('a repo without project code strategies gets no notice', () => {
    fs.rmSync(path.join(repo, 'node_modules'), { recursive: true });
    fs.rmSync(path.join(repo, '.xray/strategies/vecxrayjs.js'));
    fs.rmSync(path.join(repo, '.xray/strategies/vecxrayts.ts'));
    const r = run(['strategy', 'list'], repo);
    expect(r.stderr).not.toContain(VAR);
  });

  it('listing the skipped names does not execute them', () => {
    run(['strategy', 'list'], repo);
    run(['--log-level', 'debug', 'map', '-o', 'out'], repo);
    expect(ran()).toEqual([]);
  });
});

describe(`with ${VAR}=1`, () => {
  const env = { [VAR]: '1' };

  it.each(VECTORS)('%s loads and says where from', (id, file, name) => {
    const r = run(['strategy', 'list'], repo, env);
    expect(r.status).toBe(0);
    expect(ran()).toContain(id);
    expect(r.stdout).toContain(name);
    expect(r.stderr).toContain(`loading strategy code from project path ${path.join(repo, file)} (${VAR}=1)`);
    expect(r.stderr).not.toContain('not loaded');
  });

  it('--version and --help load it too (opt-in is global, not per command)', () => {
    run(['--version'], repo, env);
    expect(ran()).toContain('xray-js');
  });

  it('a loaded strategy command runs', () => {
    run(['vecxrayjs', 'go'], repo, env);
    expect(ran()).toContain('xray-js-handler');
  });

  it('shell completion still loads nothing from the project', () => {
    run(['__complete', 'strategy', 'info', ''], repo, env, true);
    expect(ran()).toEqual([]);
  });

  it('-p from elsewhere still loads nothing from the target (only cwd counts)', () => {
    run(['map', '-p', repo, '-o', 'out'], other, env);
    expect(ran()).toEqual([]);
  });
});

describe('a repo cannot enable it for itself', () => {
  const setters = {
    env: { env: { [VAR]: '1' } },
    flat: { [VAR]: '1', allowProjectStrategies: true, allowProjectCode: true },
    strategies: { strategies: { allowProject: true, allow: true }, projectStrategies: true },
  };

  it.each(Object.keys(setters))('.xrayrc.json (%s) does not', (key) => {
    write(path.join(repo, '.xrayrc.json'), JSON.stringify({ paths: ['.'], ...(setters as any)[key] }));
    run(['strategy', 'list'], repo);
    run(['map', '-o', 'out'], repo);
    expect(ran()).toEqual([]);
  });

  it('package.json does not', () => {
    write(
      path.join(repo, 'package.json'),
      JSON.stringify({ name: 'x', [VAR]: '1', env: { [VAR]: '1' }, xray: { allowProjectStrategies: true, env: { [VAR]: '1' } } })
    );
    run(['strategy', 'list'], repo);
    expect(ran()).toEqual([]);
  });

  it.each(['.env', '.env.local', '.envrc'])('%s in the repo does not', (name) => {
    write(path.join(repo, name), `${VAR}=1\nexport ${VAR}=1\n`);
    run(['strategy', 'list'], repo);
    run(['map', '-o', 'out'], repo);
    expect(ran()).toEqual([]);
  });

  it('the repo .xray directory does not', () => {
    write(path.join(repo, '.xray/env'), `${VAR}=1\n`);
    write(path.join(repo, '.xray/config.json'), JSON.stringify({ [VAR]: '1' }));
    run(['strategy', 'list'], repo);
    expect(ran()).toEqual([]);
  });
});

describe('install and create', () => {
  it('install of a code strategy does not load it without the variable', () => {
    const file = write(path.join(other, 'src-strategy.js'), strategy('installed', 'installedone'));
    const r = run(['strategy', 'install', file], repo);
    expect(ran()).toEqual([]);
    expect(r.stderr).toContain(`${VAR}=1`);
  });

  it('install of a code strategy loads it with the variable', () => {
    const file = write(path.join(other, 'src-strategy.js'), strategy('installed', 'installedone'));
    const r = run(['strategy', 'install', file], repo, { [VAR]: '1' });
    expect(ran()).toContain('installed');
    expect(r.stdout + r.stderr).toContain('installedone');
  });

  it('install of a YAML strategy needs no variable', () => {
    const file = write(path.join(other, 'y.yml'), 'name: yone\nversion: 1.0.0\ndetect:\n  files: []\n');
    const r = run(['strategy', 'install', file], repo);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain('yone');
  });

  it('create --ts warns that it will not load by default; --yaml does not', () => {
    const ts = run(['strategy', 'create', 'mine', '--ts'], repo);
    expect(ts.stderr).toContain(`${VAR}=1`);
    const yml = run(['strategy', 'create', 'other-one', '--yaml'], repo);
    expect(yml.stderr).not.toContain(VAR);
  });
});
