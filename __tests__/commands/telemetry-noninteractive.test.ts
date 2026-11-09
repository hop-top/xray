/**
 * A subprocess run (stdout piped) never records telemetry, even when the
 * user once consented. Sink: `<project>/.xray/telemetry.json` (cwd and the
 * scanned path), written by the telemetry plugin on exit.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');

const OFF_ENV = [
  'XRAY_NO_TELEMETRY', 'DO_NOT_TRACK', 'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS',
  'GITLAB_CI', 'CIRCLECI', 'TRAVIS', 'JENKINS_URL', 'BUILDKITE', 'TEAMCITY_VERSION',
];

describe('telemetry: piped subprocess with saved consent', () => {
  let tmp: string;
  let proj: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    if (!fs.existsSync(DIST_ENTRY)) {
      const tsc = require.resolve('typescript/bin/tsc');
      const r = spawnSync(process.execPath, [tsc], { cwd: ROOT, encoding: 'utf-8' });
      if (r.status !== 0) throw new Error(`tsc failed:\n${r.stdout}${r.stderr}`);
    }
  }, 120_000);

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-telemetry-pipe-'));
    proj = path.join(tmp, 'proj');
    fs.mkdirSync(proj);
    fs.writeFileSync(path.join(proj, 'a.ts'), 'export function hello() { return 1 }\n');
    // Consent saved globally, and in the project config.
    const xdg = path.join(tmp, 'xdg');
    fs.mkdirSync(path.join(xdg, 'xray'), { recursive: true });
    fs.writeFileSync(path.join(xdg, 'xray', 'config.json'), JSON.stringify({ telemetry: { enabled: true } }));
    fs.writeFileSync(path.join(proj, '.xrayrc.json'), JSON.stringify({ telemetry: { enabled: true } }));
    env = { ...process.env, XDG_CONFIG_HOME: xdg, XDG_CACHE_HOME: path.join(tmp, 'cache'), HOME: tmp };
    for (const k of OFF_ENV) delete env[k];
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it.each([
    [['paths']],
    [['map', '-p', '.', '--offline']],
  ])('xray %j writes no telemetry', (args) => {
    const r = spawnSync(process.execPath, [BIN, ...args], {
      cwd: proj, env, encoding: 'utf-8', timeout: 90_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(r.status).toBe(0);
    // No sink file, and no `.xray/` dir: a recorder that was set up (CLI
    // tracker or the Xray auto-registered plugin) creates it.
    expect(fs.existsSync(path.join(proj, '.xray', 'telemetry.json'))).toBe(false);
    expect(fs.existsSync(path.join(proj, '.xray'))).toBe(false);
  }, 90_000);
});
