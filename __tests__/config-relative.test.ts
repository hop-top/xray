/**
 * Relative `output`, `share` and `queries` in a config file resolve against
 * the directory of that file (like `paths`); command-line values keep
 * resolving against the working directory.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveConfigPaths } from '../src/lib/config';

const CLI = path.join(__dirname, '../bin/cli.js');

describe('resolveConfigPaths: output, share, queries', () => {
  const file = '/proj/conf/.xrayrc.json';

  it('resolves relative output and share against the config dir', () => {
    const r = resolveConfigPaths({ output: 'out.json', share: 's.md' } as any, file);
    expect(r.output).toBe('/proj/conf/out.json');
    expect(r.share).toBe('/proj/conf/s.md');
  });

  it('keeps absolute values, booleans and empty strings', () => {
    const r = resolveConfigPaths({ output: '/abs/o.json', share: true } as any, file);
    expect(r.output).toBe('/abs/o.json');
    expect(r.share).toBe(true);
    expect(resolveConfigPaths({ output: '' } as any, file).output).toBe('');
  });

  it('resolves queries: plain, ext-mapped and comma lists; leaves URLs', () => {
    const r = resolveConfigPaths({
      queries: ['q/a.scm', '.go:q/go.scm', 'x.scm, .py:y.scm', 'https://h/z.scm', '.rs:https://h/r.scm'],
    } as any, file);
    expect(r.queries).toEqual([
      '/proj/conf/q/a.scm',
      '.go:/proj/conf/q/go.scm',
      '/proj/conf/x.scm,.py:/proj/conf/y.scm',
      'https://h/z.scm',
      '.rs:https://h/r.scm',
    ]);
  });

  it('resolves lens and scope entries too', () => {
    const r = resolveConfigPaths({
      lenses: { l: { output: 'l.json' } },
      scopes: { s: { output: 's.json', share: 'x.md', queries: ['q.scm'] } },
    } as any, file);
    expect(r.lenses!.l.output).toBe('/proj/conf/l.json');
    expect(r.scopes!.s).toMatchObject({
      output: '/proj/conf/s.json', share: '/proj/conf/x.md', queries: ['/proj/conf/q.scm'],
    });
  });
});

describe('config in a subdirectory, run from elsewhere', () => {
  let base: string;
  let env: NodeJS.ProcessEnv;
  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'config-relative-')));
    const sub = (d: string) => {
      const p = path.join(base, '.env', d);
      fs.mkdirSync(p, { recursive: true });
      return p;
    };
    env = {
      ...process.env,
      HOME: sub('home'),
      XDG_CONFIG_HOME: sub('config'),
      XDG_CACHE_HOME: sub('cache'),
      XDG_STATE_HOME: sub('state'),
      XDG_DATA_HOME: sub('data'),
      XRAY_LANG_DIR: sub('lang'),
      NO_COLOR: '1',
      XRAY_NO_TELEMETRY: '1',
    };
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  const project = (name: string, config: unknown) => {
    const proj = path.join(base, name);
    fs.mkdirSync(path.join(proj, 'conf'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'src'));
    fs.writeFileSync(path.join(proj, 'src/a.ts'), 'export const marker = 1;\n');
    fs.writeFileSync(path.join(proj, 'conf/.xrayrc.json'), JSON.stringify(config));
    return proj;
  };

  it('--config from another cwd: output and share land next to the config', () => {
    const proj = project('p1', { output: 'out.json', share: 'sum.md' });
    const r = run(proj, 'map', '--config', 'conf/.xrayrc.json', '--format', 'json');
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(proj, 'conf/out.json'))).toBe(true);
    expect(fs.existsSync(path.join(proj, 'conf/sum.md'))).toBe(true);
    expect(fs.existsSync(path.join(proj, 'out.json'))).toBe(false);
  });

  it('CLI -o still resolves against the working directory', () => {
    const proj = project('p2', { output: 'out.json' });
    const r = run(proj, 'map', '--config', 'conf/.xrayrc.json', '--format', 'json', '-o', 'cli.json');
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(proj, 'cli.json'))).toBe(true);
    expect(fs.existsSync(path.join(proj, 'conf/out.json'))).toBe(false);
  });

  it('confinement applies after resolution: ../ out of the config dir is refused', () => {
    const proj = project('p3', { output: '../out.json' });
    const r = run(proj, 'map', '--config', 'conf/.xrayrc.json', '--format', 'json');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('output');
    expect(fs.existsSync(path.join(proj, 'out.json'))).toBe(false);
  });
});
