/**
 * `map -o` / `--share` into directories that do not exist yet must create
 * the missing parents (mkdir -p) in every output mode.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.resolve(__dirname, '../..', 'bin', 'xray');

let repo: string;
let outDir: string;

function run(args: string[]) {
  return spawnSync(process.execPath, [BIN, 'map', '-p', repo, '--skip-detect', ...args], {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, XRAY_NO_TELEMETRY: '1', FORCE_COLOR: '0' },
    timeout: 90_000,
  });
}

describe('map creates missing output parent dirs', () => {
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-mkdir-'));
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-mkdir-o-'));
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export function a() { return 1; }\n');
    execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
  });
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  const out = (...p: string[]) => path.join(outDir, ...p);

  test('chunked (default)', () => {
    const r = run(['-o', out('c', 'deep', 'out')]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(out('c', 'deep', 'out_root.txt'))).toBe(true);
  });

  test('--no-chunk single file', () => {
    const r = run(['--no-chunk', '-o', out('s', 'deep', 'out')]);
    expect(r.status).toBe(0);
    expect(fs.readdirSync(out('s', 'deep')).some(f => f.startsWith('out'))).toBe(true);
  });

  test('--no-chunk --share into missing dir', () => {
    const r = run(['--no-chunk', '-o', out('ss', 'o'), '--share', out('ss', 'share', 'x.md')]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(out('ss', 'share', 'x.md'))).toBe(true);
  });

  test('chunked --share into missing dir', () => {
    const r = run(['-o', out('cs', 'o'), '--share', out('cs', 'share', 'x.md')]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(out('cs', 'share', 'x.md'))).toBe(true);
  });

  test('--format json --share into missing dir', () => {
    const r = run(['--format', 'json', '-o', out('j', 'o.json'), '--share', out('j', 'share', 'x.md')]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(out('j', 'share', 'x.md'))).toBe(true);
  });
});
