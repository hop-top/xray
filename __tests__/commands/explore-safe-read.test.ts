/**
 * `explore --search` and `--stats` read project files through the shared safe
 * read: a file over the 16 MiB cap, or a link to a FIFO, is skipped (one
 * notice with counts on stderr at exit), never read whole or waited on.
 * Built bin, spawned.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const posix = process.platform !== 'win32';

let sandbox: string;
let repo: string;
let env: NodeJS.ProcessEnv;

const cli = (...args: string[]) =>
  spawnSync(process.execPath, [BIN, '--no-telemetry', ...args], {
    cwd: repo, env, encoding: 'utf-8', timeout: 30_000, killSignal: 'SIGKILL', input: '',
  });

beforeAll(() => {
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-explore-safe-')));
  const home = path.join(sandbox, 'home');
  fs.mkdirSync(home, { recursive: true });
  env = {
    PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: home, LANG: 'C', NO_COLOR: '1',
    XDG_CONFIG_HOME: path.join(home, 'c'), XDG_CACHE_HOME: path.join(home, 'k'),
    XDG_DATA_HOME: path.join(home, 'd'), XDG_STATE_HOME: path.join(home, 's'),
  };
  repo = path.join(sandbox, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'small.ts'), 'export const NEEDLE = 1;\nexport const b = 2;\n');
  // 17 MiB sparse file with the keyword at the top: only a read reaches it.
  const big = path.join(repo, 'src', 'big.ts');
  fs.writeFileSync(big, 'export const NEEDLE = 2;\n');
  fs.truncateSync(big, 17 * 1024 * 1024);
  if (posix) {
    const fifo = path.join(sandbox, 'pipe');
    const r = spawnSync('mkfifo', [fifo]);
    if (r.status === 0) fs.symlinkSync(fifo, path.join(repo, 'src', 'fifo-link.ts'));
  }
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('explore --search', () => {
  it('skips an oversize file and a link to a FIFO, finds the rest, notes once', () => {
    const r = cli('explore', '--search', 'NEEDLE', '--format', 'json');
    expect(r.signal).toBeNull();
    expect(r.status).toBe(0);
    const files = (JSON.parse(r.stdout) as { file: string }[]).map(row => path.basename(row.file));
    expect(files).toEqual(['small.ts']);
    expect(r.stderr).toMatch(/skipped \d+ unsafe file\(s\):.*over 16 MiB/);
    expect(r.stderr.match(/skipped \d+ unsafe file/g)).toHaveLength(1);
  });
});

describe('explore --stats', () => {
  it('does not count lines of an oversize file, and notes it', () => {
    const r = cli('explore', '--stats', '--format', 'json');
    expect(r.signal).toBeNull();
    expect(r.status).toBe(0);
    const rows = JSON.parse(r.stdout) as { type: string; files: number; lines: number }[];
    const ts = rows.find(row => row.type === '.ts')!;
    // small.ts: 3 split segments; big.ts (sparse zeros, one line) would add 1 more
    expect(ts.lines).toBe(3);
    expect(r.stderr).toMatch(/skipped \d+ unsafe file\(s\):.*over 16 MiB/);
  });
});
