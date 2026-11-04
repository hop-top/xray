/**
 * End-to-end: `--preset <path|pkg>` through the built CLI (bin/cli.js).
 *
 * The built CLI is CommonJS, so the resolver must hand `require` a
 * filesystem path or package name. Under ts-jest the old `file://` URL
 * specifier loaded fine, so only a subprocess against `dist` catches a
 * regression. Each preset appends a marker line when its plugin applies,
 * proving the preset ran, not merely that loading did not error.
 *
 * Requires `npm run build` first (dist/ is what ships).
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergeConfig } from '../../../src/lib/config';

const CLI_PATH = path.join(__dirname, '../../../bin/cli.js');

const presetSource = (id: string, body: string): string => `
const fs = require('fs');
function preset() {
  return [{ name: 'marker-${id}', version: '0.0.0', apply() {
    fs.appendFileSync(process.env.PRESET_MARK, '${id}\\n');
  } }];
}
${body}
`;

describe('--preset path/package through the built CLI', () => {
  let proj: string;
  let home: string;
  let mark: string;

  beforeAll(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-cli-proj-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-cli-home-'));
    mark = path.join(home, 'mark');
    fs.mkdirSync(path.join(proj, 'src'));
    fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"p"}');
    fs.writeFileSync(path.join(proj, 'src/a.ts'), 'export const a = 1;\n');

    const w = (name: string, text: string) => fs.writeFileSync(path.join(proj, name), text);
    w('p.js', presetSource('module-exports', 'module.exports = preset;'));
    w('documented.js', presetSource('documented',
      'module.exports = preset;\nmodule.exports.default = module.exports;'));
    w('named.cjs', presetSource('named', 'exports.myPreset = preset;'));
    w('dflt.cjs', presetSource('dflt', 'module.exports = { default: preset };'));
    w('esm.mjs', `import fs from 'fs';
export default function () {
  return [{ name: 'marker-esm', version: '0.0.0', apply() {
    fs.appendFileSync(process.env.PRESET_MARK, 'esm\\n');
  } }];
}
`);
    w('esm-named.mjs', `import fs from 'fs';
export function myPreset() {
  return [{ name: 'marker-esm-named', version: '0.0.0', apply() {
    fs.appendFileSync(process.env.PRESET_MARK, 'esm-named\\n');
  } }];
}
`);
    const pkgDir = path.join(proj, 'node_modules/@scope/xray-preset-foo');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'),
      '{"name":"@scope/xray-preset-foo","main":"index.js"}');
    fs.writeFileSync(path.join(pkgDir, 'index.js'), presetSource('pkg', 'module.exports = preset;'));
  });

  afterAll(() => {
    fs.rmSync(proj, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => fs.rmSync(mark, { force: true }));

  const run = (...args: string[]) =>
    spawnSync('node', [CLI_PATH, ...args], {
      cwd: proj,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_DATA_HOME: path.join(home, 'data'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
        NO_COLOR: '1',
        PRESET_MARK: mark,
      },
      encoding: 'utf8',
    });

  const marks = () => (fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim().split('\n') : []);

  const forms: Array<[string, () => string, string]> = [
    ['relative .js, module.exports', () => './p.js', 'module-exports'],
    ['absolute .js', () => path.join(proj, 'p.js'), 'module-exports'],
    ['documented example (module.exports + .default)', () => './documented.js', 'documented'],
    ['.cjs named export', () => './named.cjs', 'named'],
    ['.cjs { default }', () => './dflt.cjs', 'dflt'],
    ['.mjs default export', () => './esm.mjs', 'esm'],
    ['.mjs named export', () => './esm-named.mjs', 'esm-named'],
    ['package resolved from cwd', () => '@scope/xray-preset-foo', 'pkg'],
  ];

  it.each(forms)('%s runs the preset', (_label, spec, id) => {
    const r = run('map', '--preset', spec());
    expect(r.stderr).not.toContain('failed to apply');
    expect(r.stderr).not.toContain('Cannot find module');
    expect(r.status).toBe(0);
    expect(marks()).toEqual([id]);
  });

  it('still warns and continues when a preset path does not exist', () => {
    const r = run('map', '--preset', './nope.js');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('failed to apply "./nope.js"');
    expect(marks()).toEqual([]);
  });

  it('a config key cannot name a preset', () => {
    fs.writeFileSync(path.join(proj, '.xrayrc.json'), JSON.stringify({ preset: ['./p.js'] }));
    try {
      const viaConfig = run('map');
      expect(viaConfig.status).toBe(0);
      expect(marks()).toEqual([]);
      // Same project, same file, named on the CLI: runs (control).
      const viaFlag = run('map', '--preset', './p.js');
      expect(viaFlag.status).toBe(0);
      expect(marks()).toEqual(['module-exports']);
    } finally {
      fs.rmSync(path.join(proj, '.xrayrc.json'), { force: true });
    }
  });
});

describe('mergeConfig preset source', () => {
  it('takes presets only from CLI options, never from config', () => {
    const cfg: any = { preset: ['./evil.js'], presets: ['./evil.js'] };
    expect(mergeConfig(cfg, {}).preset).toEqual([]);
    expect(mergeConfig(cfg, { preset: ['./cli.js'] }).preset).toEqual(['./cli.js']);
    expect(mergeConfig(null, {}).preset).toEqual([]);
  });
});
