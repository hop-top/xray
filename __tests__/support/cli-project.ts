/**
 * Throwaway project + isolated config/cache/state dirs for tests that
 * drive the built CLI (bin/cli.js).
 */
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../bin/cli.js');

export interface CliProject {
  root: string;
  env: NodeJS.ProcessEnv;
  run: (...args: string[]) => SpawnSyncReturns<string>;
  cleanup: () => void;
}

export function createCliProject(files: Record<string, string> = {}): CliProject {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-proj-')));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  const sub = (d: string) => {
    const p = path.join(os.tmpdir(), path.basename(root) + '-env', d);
    fs.mkdirSync(p, { recursive: true });
    return p;
  };
  const env = {
    ...process.env,
    HOME: sub('home'),
    XDG_CONFIG_HOME: sub('config'),
    XDG_CACHE_HOME: sub('cache'),
    XDG_STATE_HOME: sub('state'),
    XDG_DATA_HOME: sub('data'),
    NO_COLOR: '1',
    XRAY_NO_TELEMETRY: '1',
  };
  return {
    root,
    env,
    run: (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' }),
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(path.join(os.tmpdir(), path.basename(root) + '-env'), { recursive: true, force: true });
    },
  };
}
