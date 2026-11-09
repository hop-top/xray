/**
 * End-to-end: a preset never leaks into the shared persistent cache.
 * Sequences run through the built CLI (bin/cli.js) against one project and
 * one cache dir; each preset renames symbol `foo` in `parse:after`, and a
 * marker line is appended whenever the preset's handlers fire.
 *
 * Requires `npm run build` first.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI_PATH = path.join(__dirname, '../../../bin/cli.js');

const renamePreset = (to: string): string => `
const fs = require('fs');
module.exports = () => [{ name: 'rename-${to}', version: '0.0.0', apply(xray) {
  xray.on('parse:before', (e) => fs.appendFileSync(process.env.PRESET_MARK, 'before:${to}\\n'));
  xray.on('parse:after', (e) => {
    fs.appendFileSync(process.env.PRESET_MARK, 'after:${to}\\n');
    for (const t of e.tags) if (t.name === 'foo') t.name = '${to}';
  });
} }];
`;

describe('preset runs do not leak into the persistent cache', () => {
  let proj: string;
  let home: string;
  let mark: string;
  let out: string;
  let ra: string;
  let rb: string;

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-iso-proj-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-iso-home-'));
    mark = path.join(home, 'mark');
    out = path.join(home, 'graph.json');
    // Preset files live outside the project so they are not scanned.
    ra = path.join(home, 'ra.js');
    rb = path.join(home, 'rb.js');
    fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"p"}');
    fs.writeFileSync(path.join(proj, 'a.ts'), 'export function foo() { return 1; }\n');
    fs.writeFileSync(ra, renamePreset('AAA'));
    fs.writeFileSync(rb, renamePreset('BBB'));
  });

  afterEach(() => {
    fs.rmSync(proj, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** Run `map --format json` and return the symbol names of a.ts in the graph. */
  const map = (...presets: string[]): { names: string[]; marks: string[] } => {
    fs.rmSync(mark, { force: true });
    fs.rmSync(out, { force: true });
    const r = spawnSync('node', [CLI_PATH, 'map', '--format', 'json', '--output', out,
      ...presets.flatMap((p) => ['--preset', p])], {
      cwd: proj,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_DATA_HOME: path.join(home, 'data'),
        XDG_STATE_HOME: path.join(home, 'state'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
        NO_COLOR: '1',
        PRESET_MARK: mark,
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const text = fs.readFileSync(out, 'utf8');
    const names = ['foo', 'AAA', 'BBB'].filter((n) => text.includes(`a.ts::${n}`));
    const marks = fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim().split('\n') : [];
    return { names, marks };
  };

  it('no preset -> preset -> no preset: the last run is unedited', () => {
    expect(map().names).toEqual(['foo']);
    const withPreset = map(ra);
    expect(withPreset.names).toEqual(['AAA']);
    expect(map().names).toEqual(['foo']);
    expect(withPreset.marks).toEqual(['before:AAA', 'after:AAA']);
  });

  it('preset -> no preset: edits do not persist', () => {
    expect(map(ra).names).toEqual(['AAA']);
    expect(map().names).toEqual(['foo']);
  });

  it('preset A -> preset B: B sees unedited tags and fires its handlers', () => {
    expect(map(ra).names).toEqual(['AAA']);
    const b = map(rb);
    expect(b.names).toEqual(['BBB']);
    expect(b.marks).toEqual(['before:BBB', 'after:BBB']);
  });

  it('preset handlers fire on every run, even after a warm no-preset run', () => {
    map();
    expect(map(ra).marks).toEqual(['before:AAA', 'after:AAA']);
    expect(map(ra).marks).toEqual(['before:AAA', 'after:AAA']);
  });

  it('editing the preset file changes the next run', () => {
    expect(map(ra).names).toEqual(['AAA']);
    fs.writeFileSync(ra, renamePreset('CCC'));
    const text = () => fs.readFileSync(out, 'utf8');
    map(ra);
    expect(text()).toContain('a.ts::CCC');
    expect(text()).not.toContain('a.ts::AAA');
  });
});
