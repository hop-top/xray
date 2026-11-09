import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

const ROOT = path.resolve(__dirname, '..');
const RAW = fs.readFileSync(path.join(ROOT, 'action.yaml'), 'utf8');

interface Step { name?: string; id?: string; if?: string; run?: string; env?: Record<string, string> }
interface Action { runs: { steps: Step[] } }
const action = yaml.load(RAW) as Action;
const step = (name: string): Step => {
  const s = action.runs.steps.find(x => x.name === name);
  if (!s) throw new Error(`action.yaml: no step named "${name}"`);
  return s;
};

type Ctx = Record<string, string>;

/** Literal text replacement of ${{ ... }}, the way the Actions runner does it before bash sees the script. */
const substitute = (text: string, ctx: Ctx): string =>
  text.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_m, expr: string) => {
    if (!(expr in ctx)) throw new Error(`test has no value for expression: ${expr}`);
    return ctx[expr];
  });

let dir: string;
let work: string;
let bin: string;

const sysPath = ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin'].join(':');

const readArgs = (file: string): string[] => {
  if (!fs.existsSync(file)) return [];
  const parts = fs.readFileSync(file, 'utf8').split('\0');
  parts.pop();
  return parts;
};

const stub = (name: string, body = '') =>
  fs.writeFileSync(
    path.join(bin, name),
    `#!/bin/bash\nprintf '%s\\0' "$@" > "${dir}/${name}.args"\n${body}\n`,
    { mode: 0o755 },
  );

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-action-'));
  work = path.join(dir, 'work');
  bin = path.join(dir, 'bin');
  fs.mkdirSync(work);
  fs.mkdirSync(bin);
  stub('npm');
  stub('xray', '[ "$1" = "--version" ] && echo 0.0.0-stub; exit 0');
  spawnSync('git', ['init', '-q'], { cwd: work, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

interface Run { status: number | null; out: string; outputs: Record<string, string>; outputLines: string[]; summary: string }

const run = (name: string, ctx: Ctx): Run => {
  const s = step(name);
  const script = path.join(dir, 'step.sh');
  fs.writeFileSync(script, substitute(s.run ?? '', ctx));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.env ?? {})) env[k] = substitute(v, ctx);
  const ghOut = path.join(dir, 'github_output');
  const ghSum = path.join(dir, 'github_summary');
  fs.writeFileSync(ghOut, '');
  fs.writeFileSync(ghSum, '');
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
    cwd: work,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${sysPath}`,
      HOME: dir,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GITHUB_OUTPUT: ghOut,
      RUNNER_TEMP: dir,
      GITHUB_STEP_SUMMARY: ghSum,
      ...env,
    },
  });
  const outputLines = fs.readFileSync(ghOut, 'utf8').split('\n').filter(Boolean);
  const outputs: Record<string, string> = {};
  for (const l of outputLines) {
    const i = l.indexOf('=');
    outputs[l.slice(0, i)] = l.slice(i + 1);
  }
  return { status: r.status, out: r.stdout + r.stderr, outputs, outputLines, summary: fs.readFileSync(ghSum, 'utf8') };
};

const marker = () => [work, dir, process.cwd()].some(d => fs.existsSync(path.join(d, 'PWNED')));

const HOSTILE = [
  'x"; touch PWNED; "',
  '$(touch PWNED)',
  '`touch PWNED`',
  "x'; touch PWNED; '",
  'a && touch PWNED',
  'a\ntouch PWNED',
  '${IFS}touch${IFS}PWNED',
];

describe('action.yaml shell safety', () => {
  test('no ${{ }} expression appears inside any run script', () => {
    for (const s of action.runs.steps) {
      if (s.run !== undefined) expect([s.name, s.run.includes('${{')]).toEqual([s.name, false]);
    }
  });

  test('no step evals or word-splits an assembled command string', () => {
    for (const s of action.runs.steps) {
      expect([s.name, /\beval\b/.test(s.run ?? '')]).toEqual([s.name, false]);
    }
  });

  describe('Install xray', () => {
    const install = (v: string) => run('Install xray', { 'inputs.xray-version': v });

    test.each(['latest', '1.2.3', '0.0.1', '10.20.30', '1.0.0-rc.0', '0.1.0-alpha.1', '2.0.0-beta-2.x'])(
      'accepts %s and passes it to npm as one argument',
      v => {
        const r = install(v);
        expect(r.status).toBe(0);
        expect(readArgs(path.join(dir, 'npm.args'))).toEqual(['install', '-g', `@hop-top/xray@${v}`]);
        expect(r.out).toContain('Installed xray 0.0.0-stub');
      },
    );

    test.each([
      ...HOSTILE.map(h => `1.2.3${h}`),
      ...HOSTILE,
      '', ' ', 'latest ', 'LATEST', 'v1.2.3', '1.2', '1.2.3.4', '01.2.3', '1.2.3-', '1.2.3-a..b', '^1.2.3', '>=1', 'next',
      '1.2.3\n', '1.2.3\nfoo=bar', '../../x', '1.2.3 --foo', '1.2.3+build',
    ])('rejects %j without running npm or any injected command', v => {
      const r = install(v);
      expect(r.status).not.toBe(0);
      expect(r.out).toContain('::error::xray-version must be');
      expect(fs.existsSync(path.join(dir, 'npm.args'))).toBe(false);
      expect(marker()).toBe(false);
    });

    test('error message is a single line even for a multi-line value', () => {
      const r = install('1.2.3\n::set-output name=x::y');
      expect(r.out.split('\n').filter(l => l.startsWith('::'))).toHaveLength(1);
    });
  });

  describe('Check for xray config', () => {
    const check = (p: string) => run('Check for xray config', { 'inputs.config-path': p });

    test('normal path: outputs and success', () => {
      fs.writeFileSync(path.join(work, 'my config.json'), '{}');
      const r = check('my config.json');
      expect(r.status).toBe(0);
      expect(r.outputs).toEqual({ config_exists: 'true', config_path: 'my config.json' });
    });

    test('missing file fails with config_exists=false', () => {
      const r = check('nope.json');
      expect(r.status).not.toBe(0);
      expect(r.outputs).toEqual({ config_exists: 'false' });
    });

    test('empty input auto-detects', () => {
      fs.writeFileSync(path.join(work, '.xrayrc'), '{}');
      const r = check('');
      expect(r.status).toBe(0);
      expect(r.outputs).toEqual({ config_exists: 'true', config_path: '' });
    });

    test('empty input, nothing to detect: skips', () => {
      const r = check('');
      expect(r.status).toBe(0);
      expect(r.outputs).toEqual({ config_exists: 'false' });
    });

    test.each(HOSTILE.filter(h => !h.includes('\n')))('hostile existing file name %j is treated as data', h => {
      fs.writeFileSync(path.join(work, h), '{}');
      const r = check(h);
      expect(r.status).toBe(0);
      expect(r.outputs).toEqual({ config_exists: 'true', config_path: h });
      expect(marker()).toBe(false);
    });

    test.each(HOSTILE.filter(h => !h.includes('\n')))('hostile missing path %j is treated as data', h => {
      const r = check(h);
      expect(r.status).not.toBe(0);
      expect(marker()).toBe(false);
    });

    test.each(['cfg.json\nfoo=bar', 'cfg.json\r\nfoo=bar', 'cfg.json\n::error::pwn'])(
      'line break in %j cannot inject outputs or log commands',
      p => {
        fs.writeFileSync(path.join(work, p), '{}'); // exists, so an unguarded script would write it to GITHUB_OUTPUT
        const r = check(p);
        expect(r.status).not.toBe(0);
        expect(r.outputLines).toEqual([]);
        expect(r.out).toContain('config-path must not contain line breaks');
        expect(r.out).not.toMatch(/^::error::pwn/m);
      },
    );
  });

  test.each(['✓ found', 'missing'])('a logged config path cannot act as a ##[ log command (%s)', kind => {
    const p = 'a ##[warning]pwned';
    if (kind !== 'missing') fs.writeFileSync(path.join(work, p), '{}');
    const r = run('Check for xray config', { 'inputs.config-path': p });
    expect(r.out).not.toContain('##[');
  });

  describe('Regenerate xray maps', () => {
    const regen = (o: { config?: string; scope?: string; all?: string } = {}) =>
      run('Regenerate xray maps', {
        'steps.check-config.outputs.config_path': o.config ?? '',
        'inputs.scope': o.scope ?? '',
        'inputs.all-scopes': o.all ?? 'true',
      });
    const xrayArgs = () => readArgs(path.join(dir, 'xray.args'));

    test('defaults: all scopes', () => {
      const r = regen();
      expect(r.status).toBe(0);
      expect(xrayArgs()).toEqual(['map', '--all-scopes']);
      expect(r.outputs).toEqual({ changes_detected: 'false' });
    });

    test('all-scopes=false and no scope: bare map', () => {
      expect(regen({ all: 'false' }).status).toBe(0);
      expect(xrayArgs()).toEqual(['map']);
    });

    test('config and scope pass through; scope wins over all-scopes', () => {
      expect(regen({ config: 'conf/x.json', scope: 'api' }).status).toBe(0);
      expect(xrayArgs()).toEqual(['map', '--config=conf/x.json', '--scope=api']);
    });

    test('a scope with spaces stays one argument', () => {
      regen({ scope: 'my scope' });
      expect(xrayArgs()).toEqual(['map', '--scope=my scope']);
    });

    test.each(HOSTILE.filter(h => !h.includes('\n')))('hostile scope %j reaches xray verbatim as one argument', h => {
      const r = regen({ scope: h });
      expect(r.status).toBe(0);
      expect(xrayArgs()).toEqual(['map', `--scope=${h}`]);
      expect(marker()).toBe(false);
    });

    test.each(HOSTILE.filter(h => !h.includes('\n')))('hostile config path %j reaches xray verbatim as one argument', h => {
      const r = regen({ config: h });
      expect(r.status).toBe(0);
      expect(xrayArgs()).toEqual(['map', `--config=${h}`, '--all-scopes']);
      expect(marker()).toBe(false);
    });

    test.each(['--config=./evil.js', '--chdir=/tmp', '-C', '--help'])('scope %j stays bound to --scope, never a flag of its own', v => {
      expect(regen({ scope: v }).status).toBe(0);
      expect(xrayArgs()).toEqual(['map', `--scope=${v}`]);
    });

    test.each(['--config=./evil.js', '-C'])('config path %j stays bound to --config, never a flag of its own', v => {
      expect(regen({ config: v }).status).toBe(0);
      expect(xrayArgs()).toEqual(['map', `--config=${v}`, '--all-scopes']);
    });

    test('a logged scope cannot act as a ##[ log command', () => {
      const r = regen({ scope: 'a ##[warning]pwned' });
      expect(r.status).toBe(0);
      expect(r.out).not.toContain('##[');
    });

    test('hostile all-scopes value is only compared, never executed', () => {
      const r = regen({ all: '$(touch PWNED)' });
      expect(r.status).toBe(0);
      expect(xrayArgs()).toEqual(['map']);
      expect(marker()).toBe(false);
    });

    test('line break in scope cannot inject outputs or log commands', () => {
      const r = regen({ scope: 'api\nchanges_detected=true' });
      expect(r.status).not.toBe(0);
      expect(r.outputLines).toEqual([]);
      expect(fs.existsSync(path.join(dir, 'xray.args'))).toBe(false);
    });

    test('reports changes when xray writes files', () => {
      stub('xray', 'echo x > map.out');
      const r = regen();
      expect(r.outputs).toEqual({ changes_detected: 'true' });
    });
  });

  describe('Summary', () => {
    test.each([
      ['true', 'updated and committed'],
      ['false', 'already up to date'],
      ['$(touch PWNED)', 'already up to date'],
    ])('changes_detected=%s', (v, text) => {
      const r = run('Summary', { 'steps.regenerate.outputs.changes_detected': v });
      expect(r.status).toBe(0);
      expect(r.summary).toContain(text);
      expect(marker()).toBe(false);
    });
  });

  describe('Commit and push changes', () => {
    const gitIn = (...a: string[]) =>
      spawnSync('git', a, { cwd: work, encoding: 'utf8', env: { ...process.env, HOME: dir, XDG_CONFIG_HOME: dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
        .stdout;
    const regen = () =>
      run('Regenerate xray maps', {
        'steps.check-config.outputs.config_path': '',
        'inputs.scope': '',
        'inputs.all-scopes': 'true',
      });
    const commit = (msg = 'chore: maps') => run('Commit and push changes', { 'inputs.commit-message': msg });
    const generated = () => {
      const f = path.join(dir, 'xray-generated.list');
      return fs.existsSync(f) ? readArgs(f).sort() : [];
    };
    const seedRepo = () => {
      fs.writeFileSync(path.join(work, 'tracked.ts'), 'a\n');
      fs.writeFileSync(path.join(work, '.xray_root.md'), 'old map\n');
      gitIn('add', 'tracked.ts', '.xray_root.md');
      gitIn('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'seed');
    };
    const committedFiles = () => gitIn('show', '-z', '--name-only', '--format=', 'HEAD').split('\0').filter(Boolean).sort();

    test('commit message is data', () => {
      seedRepo();
      stub('xray', 'echo new > .xray_src.md');
      regen();
      const r = commit('x"; touch PWNED; "');
      expect(r.status).toBe(0);
      expect(marker()).toBe(false);
      expect(gitIn('log', '-1', '--format=%s').trim()).toBe('x"; touch PWNED; "');
    });

    test('records and commits what xray wrote, not a leftover secret', () => {
      seedRepo();
      fs.writeFileSync(path.join(work, 'secret.env'), 'TOKEN=hunter2\n');
      fs.mkdirSync(path.join(work, 'build'));
      fs.writeFileSync(path.join(work, 'build', 'out.js'), 'x\n');
      fs.writeFileSync(path.join(work, 'tracked.ts'), 'edited by an earlier step\n');
      stub('xray', 'echo changed > .xray_root.md; mkdir -p docs; echo m > docs/map.txt; echo j > .xray.json');
      const r = regen();
      expect(r.outputs).toEqual({ changes_detected: 'true' });
      expect(generated()).toEqual(['.xray.json', '.xray_root.md', 'docs/map.txt']);
      expect(commit().status).toBe(0);
      expect(committedFiles()).toEqual(['.xray.json', '.xray_root.md', 'docs/map.txt']);
      const left = gitIn('status', '--porcelain', '--untracked-files=all');
      expect(left).toContain('?? secret.env');
      expect(left).toContain('?? build/out.js');
      expect(left).toContain(' M tracked.ts');
    });

    test('a leftover alone is not a change', () => {
      seedRepo();
      fs.writeFileSync(path.join(work, 'secret.env'), 'TOKEN=hunter2\n');
      stub('xray', 'exit 0');
      const r = regen();
      expect(r.outputs).toEqual({ changes_detected: 'false' });
      expect(generated()).toEqual([]);
    });

    test('a file xray rewrites with identical content is not a change', () => {
      seedRepo();
      fs.writeFileSync(path.join(work, 'secret.env'), 'a\n');
      stub('xray', 'echo a > secret.env');
      expect(regen().outputs).toEqual({ changes_detected: 'false' });
    });

    test('a map xray deletes is committed as a deletion', () => {
      seedRepo();
      stub('xray', 'rm .xray_root.md');
      expect(regen().outputs).toEqual({ changes_detected: 'true' });
      expect(commit().status).toBe(0);
      expect(gitIn('show', '--name-status', '--format=', 'HEAD').trim()).toBe('D\t.xray_root.md');
    });

    test('something an earlier step already staged stays out of the commit', () => {
      seedRepo();
      fs.writeFileSync(path.join(work, 'staged-secret.env'), 's\n');
      gitIn('add', 'staged-secret.env');
      stub('xray', 'echo new > .xray_src.md');
      regen();
      expect(commit().status).toBe(0);
      expect(committedFiles()).toEqual(['.xray_src.md']);
      expect(gitIn('status', '--porcelain')).toContain('A  staged-secret.env');
    });

    test.each(['my map.txt', ':(top)x.txt', '*.glob', '-dash.txt', "q'uote.txt", 'new\nline.txt'])(
      'output path %j is matched literally',
      name => {
        seedRepo();
        fs.writeFileSync(path.join(work, 'other.txt'), 'o\n');
        fs.writeFileSync(path.join(work, 'x.txt'), 'o\n');
        fs.writeFileSync(path.join(dir, 'outname'), name);
        stub('xray', `IFS= read -r -d '' n < "${dir}/outname"; printf m > "$n"`);
        regen();
        expect(generated()).toEqual([name]);
        expect(commit().status).toBe(0);
        expect(committedFiles()).toEqual([name]);
      },
    );
  });
});

describe('action.yaml supply chain', () => {
  test('no github-token input: nothing in the action uses one', () => {
    expect(Object.keys((yaml.load(RAW) as { inputs: object }).inputs)).not.toContain('github-token');
    expect(RAW).not.toMatch(/github[-_.]token/i);
  });

  test('every external action is pinned to a full commit SHA with a version comment', () => {
    const uses = [...RAW.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(?:\s*#\s*(\S+))?/gm)];
    expect(uses.length).toBeGreaterThan(0);
    for (const m of uses) expect([m[1], m[2] !== undefined]).toEqual([expect.stringMatching(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/), true]);
  });
});
