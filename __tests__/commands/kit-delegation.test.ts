/**
 * Kit's delegation gates as the built CLI meets them.
 *
 * Kit gates an unannotated leaf named delete|remove|rm|destroy|purge|drop
 * behind a confirmation that is refused without a terminal, and reserves
 * --dry-run, --confirm, --max-ops and --policy on the root. xray's remove
 * commands manage state xray owns (an alias entry, a strategy file or
 * package, an xray-managed language pack): they declare that tier, so
 * scripts, CI and agents run them with no terminal. Spawns the built CLI
 * (`npm run build` first); stdin is never a terminal here.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');

let tmp: string;
let proj: string;
let strategies: string;
let langDir: string;

function run(args: string[]) {
  const r = spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', ...args], {
    cwd: proj,
    input: '',
    env: {
      PATH: process.env.PATH,
      TMPDIR: tmp,
      HOME: tmp,
      XRAY_LANG_DIR: langDir,
      XDG_CONFIG_HOME: path.join(tmp, 'cfg'),
      XDG_CACHE_HOME: path.join(tmp, 'cache'),
      XDG_DATA_HOME: path.join(tmp, 'data'),
      XDG_STATE_HOME: path.join(tmp, 'state'),
      XRAY_NO_TELEMETRY: '1',
      NO_COLOR: '1',
    },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const aliasFile = () => path.join(proj, '.xrayrc.json');
const hasAlias = () => (JSON.parse(fs.readFileSync(aliasFile(), 'utf-8')).aliases ?? {}).foo !== undefined;
const strategyFile = () => path.join(strategies, 'foo.yml');

beforeAll(() => {
  if (!fs.existsSync(ENTRY)) throw new Error('dist missing: run `npm run build` first');
});

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-kit-delegation-')));
  proj = path.join(tmp, 'proj');
  strategies = path.join(tmp, 'data', 'xray', 'strategies');
  langDir = path.join(tmp, 'lang');
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(strategies, { recursive: true });
  fs.mkdirSync(langDir, { recursive: true });
  fs.writeFileSync(aliasFile(), JSON.stringify({ paths: ['.'], aliases: { foo: 'react components' } }));
  fs.writeFileSync(strategyFile(), 'name: foo\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('remove commands run without a terminal', () => {
  it('alias remove', () => {
    const r = run(['alias', 'remove', 'foo']);
    expect(r.out).toContain('Removed alias "foo"');
    expect(r.status).toBe(0);
    expect(hasAlias()).toBe(false);
  });

  it.each(['remove', 'uninstall'])('strategy %s (project-independent strategy file)', (verb) => {
    const r = run(['strategy', verb, 'foo']);
    expect(r.out).toContain('Strategy removed');
    expect(r.status).toBe(0);
    expect(fs.existsSync(strategyFile())).toBe(false);
  });

  it.each(['remove', 'rm'])('lang %s', (verb) => {
    const r = run(['lang', verb, 'ruby']);
    expect(r.out).toMatch(/ruby: not (installed|managed by xray)/);
    expect(r.status).toBe(0);
  });

  it('cache clear and its legacy alias are not gated', () => {
    expect(run(['cache', 'clear']).status).toBe(0);
    expect(run(['clear-cache']).status).toBe(0);
  });
});

describe('--dry-run never lets a remove command act', () => {
  // The handlers do not preview, so they opt out; a bare declaration of the
  // write tier would make kit apply --dry-run and run them for real.
  it('alias remove --dry-run is a usage error and removes nothing', () => {
    const r = run(['alias', 'remove', 'foo', '--dry-run']);
    expect(r.status).toBe(2);
    expect(r.out).toContain('does not support --dry-run');
    expect(hasAlias()).toBe(true);
  });

  it('strategy remove --dry-run is a usage error and removes nothing', () => {
    const r = run(['strategy', 'remove', 'foo', '--dry-run']);
    expect(r.status).toBe(2);
    expect(fs.existsSync(strategyFile())).toBe(true);
  });

  it('lang remove --dry-run is a usage error', () => {
    expect(run(['lang', 'remove', 'ruby', '--dry-run']).status).toBe(2);
  });
});

describe('kit refusals keep their exit code and speak once', () => {
  it('--dry-run on an undeclared command is a usage error (2)', () => {
    const r = run(['--dry-run', 'map', '.']);
    expect(r.status).toBe(2);
    expect(r.out).toContain('kit/side-effect');
    expect(r.out.match(/cannot apply --dry-run/g)).toHaveLength(1); // kit's own envelope, not repeated by xray
  });

  it('a named policy that is not wired is a usage error (2)', () => {
    expect(run(['--policy', 'nope', 'alias', 'list']).status).toBe(2);
  });

  it('kit-default refuses a write without a caller; nothing is removed', () => {
    const r = run(['alias', 'remove', 'foo', '--policy', 'kit-default']);
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBe(1);
    expect(hasAlias()).toBe(true);
  });
});

describe('lang add keeps its own --dry-run', () => {
  // The flag is the leaf's own, so kit must not read it as the root's gate
  // (which would refuse it: `lang add` declares no tier).
  it('is not taken by the root gate', () => {
    const r = run(['lang', 'add', 'elixir', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('kit/side-effect');
  });
});

describe('reserved root flags', () => {
  const RESERVED = new Set(['--dry-run', '--confirm', '--max-ops', '--policy']);

  it('no xray command declares one except lang add --dry-run', () => {
    const r = run(['describe', '--format', 'json']);
    expect(r.status).toBe(0);
    const doc = JSON.parse(r.out);
    const clashes: string[] = [];
    const walk = (cmds: any[], prefix: string) => {
      for (const c of cmds) {
        const qn = `${prefix}${c.name}`;
        for (const o of c.options ?? []) {
          if (RESERVED.has(String(o.name))) clashes.push(`${qn} ${o.name}`);
        }
        walk(c.subcommands ?? [], `${qn} `);
      }
    };
    walk(doc.commands, '');
    expect(clashes).toEqual(['lang add --dry-run']);
  });
});
