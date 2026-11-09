/**
 * `config list|keys|values --format json`: stdout is one JSON document, no
 * text heading before it. Spawns the built CLI (`npm run build` first).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ENTRY = path.resolve(__dirname, '../../dist/index.js');

let tmp: string;
let repo: string;

function run(args: string[]) {
  const home = path.join(tmp, 'home');
  return spawnSync(process.execPath, [ENTRY, '--no-telemetry', '--offline', ...args], {
    cwd: repo,
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      XDG_CACHE_HOME: path.join(home, '.cache'),
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      XDG_STATE_HOME: path.join(home, '.local', 'state'),
      NO_COLOR: '1',
    },
    input: '',
    encoding: 'utf-8',
    timeout: 60_000,
  });
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cfgjson-')));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(tmp, 'home'), { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, '.env'), 'A=1\nSECRET_KEY=x\n');
  fs.writeFileSync(path.join(repo, 'config.json'), '{"a":{"b":1}}\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe.each(['list', 'keys', 'values'])('config %s --format json', (sub) => {
  it('stdout parses as JSON', () => {
    const r = run(['config', sub, '--format', 'json']);
    expect(r.status).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stdout).not.toMatch(/Configuration (Files|Keys|Values):/);
  });
});

it('config list --format json carries the files', () => {
  const doc = JSON.parse(run(['config', 'list', '--format', 'json']).stdout);
  expect(doc.files.sort()).toEqual(['.env', 'config.json']);
  expect(doc.count).toBe(2);
});

it('config list in text mode keeps its heading', () => {
  const r = run(['config', 'list']);
  expect(r.stdout).toContain('Configuration Files:');
});
