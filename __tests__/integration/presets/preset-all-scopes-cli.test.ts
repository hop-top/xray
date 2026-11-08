/**
 * End-to-end: `--all-scopes --preset <spec>` applies the preset to every
 * scope, the same as a normal run. Built CLI (bin/cli.js); needs
 * `npm run build` first.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_PATH = path.join(__dirname, '../../../bin/cli.js');

describe('--all-scopes with --preset', () => {
  let proj: string;
  let home: string;
  let mark: string;

  beforeAll(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-scopes-proj-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-scopes-home-'));
    mark = path.join(home, 'mark');
    for (const dir of ['one', 'two']) {
      fs.mkdirSync(path.join(proj, dir));
      fs.writeFileSync(path.join(proj, dir, 'a.ts'), 'export const a = 1;\n');
    }
    fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"p"}');
    fs.writeFileSync(path.join(proj, 'logs.js'), `
const fs = require('fs');
module.exports = () => [{ name: 'scope-logger', version: '0.0.0', apply(xray) {
  fs.appendFileSync(process.env.PRESET_MARK, 'applied\\n');
} }];
`);
    fs.writeFileSync(path.join(proj, '.xrayrc.json'), JSON.stringify({
      scopes: {
        one: { paths: ['one'], output: path.join(proj, 'one.txt') },
        two: { paths: ['two'], output: path.join(proj, 'two.txt') },
      },
    }));
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

  it('applies the preset once per scope', () => {
    const r = run('map', '--all-scopes', '--preset', './logs.js');
    expect(r.status).toBe(0);
    expect(marks()).toEqual(['applied', 'applied']);
  });

  it('without --preset applies nothing (control)', () => {
    const r = run('map', '--all-scopes');
    expect(r.status).toBe(0);
    expect(marks()).toEqual([]);
  });
});
