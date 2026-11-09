/**
 * Kit's delegation gates as the built CLI meets them.
 *
 * Every leaf declares its tier (see side-effect.ts). Kit refuses a
 * destructive one (`strategy remove`, `cache clear`) unless the caller
 * confirms, applies a root `--dry-run` to the writers (each prints a plan
 * instead of acting) and lets read commands run. `alias remove` and
 * `lang remove` change one recreatable entry or a managed pack: write-local,
 * not confirmed. Spawns the built CLI (`npm run build` first); the child
 * has no controlling terminal, so nothing can be asked.
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
    // Own session (setsid): no controlling terminal for a prompt to reach.
    ...({ detached: true } as object),
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const aliasFile = () => path.join(proj, '.xrayrc.json');
const hasAlias = () => (JSON.parse(fs.readFileSync(aliasFile(), 'utf-8')).aliases ?? {}).foo !== undefined;
const strategyFile = () => path.join(strategies, 'foo.yml');
const cacheDbs = () => {
  const found: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'xray_cache.db') found.push(p);
    }
  };
  walk(path.join(tmp, 'cache'));
  return found;
};
const outputs = () => fs.readdirSync(proj).filter(f => f.startsWith('.xray_') || f.startsWith('.xray.'));

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

describe('write-local removes run without a terminal', () => {
  it('alias remove', () => {
    const r = run(['alias', 'remove', 'foo']);
    expect(r.out).toContain('Removed alias "foo"');
    expect(r.status).toBe(0);
    expect(hasAlias()).toBe(false);
  });

  it.each(['remove', 'rm'])('lang %s', (verb) => {
    const r = run(['lang', verb, 'ruby']);
    expect(r.out).toMatch(/ruby: not (installed|managed by xray)/);
    expect(r.status).toBe(0);
  });
});

describe('strategy remove is destructive and confirmed', () => {
  it.each(['remove', 'uninstall'])('%s with no way to ask is refused; the file stays', (verb) => {
    const r = run(['strategy', verb, 'foo']);
    expect(r.status).toBe(5); // kit's refusal code for an unconfirmed destructive command
    expect(r.out).toContain('refused');
    expect(r.out).not.toContain('Strategy removed');
    expect(fs.existsSync(strategyFile())).toBe(true);
  });

  it('--confirm=no is refused; the file stays', () => {
    const r = run(['--confirm=no', 'strategy', 'remove', 'foo']);
    expect(r.status).toBe(5);
    expect(fs.existsSync(strategyFile())).toBe(true);
  });

  it('--confirm=yes removes the file', () => {
    const r = run(['--confirm=yes', 'strategy', 'remove', 'foo']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('Strategy removed');
    expect(fs.existsSync(strategyFile())).toBe(false);
  });

  describe('an installed package', () => {
    const pkgDir = () => path.join(proj, 'node_modules', 'xray-strategy-bar');
    beforeEach(() => {
      fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'p', dependencies: { 'xray-strategy-bar': '1.0.0' } }));
      fs.mkdirSync(pkgDir(), { recursive: true });
      fs.writeFileSync(path.join(pkgDir(), 'package.json'), JSON.stringify({
        name: 'xray-strategy-bar', version: '1.0.0', 'xray-strategy': { name: 'bar', entry: 'strategy.yml' },
      }));
      fs.writeFileSync(path.join(pkgDir(), 'strategy.yml'), 'name: bar\n');
    });

    it('is not uninstalled when refused', () => {
      for (const args of [['strategy', 'remove', 'bar'], ['--confirm=no', 'strategy', 'remove', 'xray-strategy-bar']]) {
        expect(run(args).status).toBe(5);
        expect(fs.existsSync(pkgDir())).toBe(true);
      }
    });

    it('--dry-run names the uninstall and changes nothing', () => {
      const r = run(['--dry-run', 'strategy', 'remove', 'bar']);
      expect(r.status).toBe(0);
      expect(r.out).toContain('npm:xray-strategy-bar');
      expect(fs.existsSync(pkgDir())).toBe(true);
    });
  });
});

describe('cache clear is destructive and confirmed', () => {
  beforeEach(() => {
    expect(run(['impact', 'nothing', '--path', proj]).status).not.toBe(2);
  });

  it('a project cache exists to clear', () => {
    expect(cacheDbs()).toHaveLength(1);
  });

  it.each([['no flag', []], ['--confirm=no', ['--confirm=no']]])('%s is refused; the cache stays', (_n, flags) => {
    for (const cmd of [['cache', 'clear'], ['clear-cache']]) {
      const r = run([...flags, ...cmd]);
      expect(r.status).toBe(5);
      expect(cacheDbs()).toHaveLength(1);
    }
  });

  it.each([['cache', 'clear'], ['clear-cache']])('--confirm=yes clears it (%s)', (...cmd) => {
    const r = run(['--confirm=yes', ...cmd]);
    expect(r.status).toBe(0);
    expect(cacheDbs()).toHaveLength(0);
  });

  it('--dry-run names the file and clears nothing', () => {
    const r = run(['--dry-run', 'cache', 'clear']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('xray_cache.db');
    expect(cacheDbs()).toHaveLength(1);
  });
});

describe('--dry-run previews writers and never acts', () => {
  const planOf = (args: string[]) => {
    const r = run(['--dry-run', ...args]);
    expect(r.status).toBe(0);
    return r.out;
  };

  it('map, graph: lists the files, writes none', () => {
    fs.writeFileSync(path.join(proj, 'a.ts'), 'export const a = 1;\n');
    for (const cmd of ['map', 'graph']) {
      expect(planOf([cmd, '.'])).toMatch(/\.xray_\*\.md/);
    }
    expect(outputs()).toEqual([]);
  });

  it('map --json plans the graph file as machine output', () => {
    const plan = JSON.parse(planOf(['map', '--json']));
    expect(plan.command).toBe('xray map');
    expect(plan.effects).toEqual([expect.objectContaining({ kind: 'create', target: path.join(proj, '.xray.json') })]);
    expect(outputs()).toEqual([]);
  });

  it('alias set: nothing written', () => {
    const out = planOf(['alias', 'set', 'bar', 'react components']);
    expect(out).toContain('alias:bar');
    expect((JSON.parse(fs.readFileSync(aliasFile(), 'utf-8')).aliases ?? {}).bar).toBeUndefined();
  });

  it('alias remove: nothing removed', () => {
    expect(planOf(['alias', 'remove', 'foo'])).toContain('alias:foo');
    expect(hasAlias()).toBe(true);
  });

  it('strategy create: nothing created', () => {
    expect(planOf(['strategy', 'create', 'zed'])).toContain('zed.yml');
    expect(fs.existsSync(path.join(proj, '.xray'))).toBe(false);
  });

  it('strategy remove: needs no confirmation, removes nothing', () => {
    expect(planOf(['strategy', 'remove', 'foo'])).toContain('foo.yml');
    expect(fs.existsSync(strategyFile())).toBe(true);
  });

  it('strategy install of an npm source: names the install, runs no npm', () => {
    expect(planOf(['strategy', 'install', 'xray-strategy-nonesuch'])).toContain('npm:xray-strategy-nonesuch');
    expect(fs.existsSync(path.join(proj, 'node_modules'))).toBe(false);
  });

  it('lang add / lang remove: plans, installs nothing', () => {
    expect(planOf(['lang', 'add', 'elixir'])).toContain('COMMAND   xray lang add');
    expect(planOf(['lang', 'remove', 'elixir'])).toContain('COMMAND   xray lang remove');
    expect(fs.readdirSync(langDir)).toEqual([]);
  });

  it('lang add --dry-run after the leaf is the same root flag', () => {
    const r = run(['lang', 'add', 'elixir', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('COMMAND   xray lang add');
    expect(fs.readdirSync(langDir)).toEqual([]);
  });

  it('a read command just runs', () => {
    const r = run(['--dry-run', 'alias', 'list']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('foo');
  });

  it('never speaks kit internals', () => {
    for (const args of [['map', '.'], ['alias', 'set', 'bar', 'react components'], ['alias', 'remove', 'foo'],
      ['strategy', 'remove', 'foo'], ['strategy', 'create', 'zed'], ['cache', 'clear'], ['lang', 'remove', 'ruby'], ['alias', 'list']]) {
      expect(planOf(args)).not.toMatch(/adopter|OptOutDryRun|kit\/side-effect/);
    }
  });

  it('mcp has no preview and says so plainly', () => {
    const r = run(['--dry-run', 'mcp']);
    expect(r.status).toBe(2);
    expect(r.out).toContain('does not accept --dry-run');
    expect(r.out).not.toMatch(/adopter|OptOutDryRun/);
  });
});

describe('kit refusals keep their exit code and speak once', () => {
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

describe('reserved root flags', () => {
  // `lang add` documents the root flag on itself; it reaches the same plan.
  const RESERVED = new Set(['--dry-run', '--confirm', '--max-ops', '--policy']);

  it('no xray command declares one but lang add --dry-run', () => {
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
