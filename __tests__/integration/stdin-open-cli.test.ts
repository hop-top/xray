/**
 * Agents and hooks run xray with stdin inherited, not redirected. A stdin
 * that never closes (open pipe) must not stall a first run: no command reads
 * stdin or waits on a prompt. Runs the built CLI with a tight timeout and a
 * fresh config/state, so the first-run path is taken. Requires `npm run build`.
 */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const TIGHT_MS = 20_000;

let sandbox: string;
let proj: string;
let env: NodeJS.ProcessEnv;

beforeAll(() => {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}${r.stderr}`);
  }
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-stdin-')));
  const home = path.join(sandbox, 'home');
  fs.mkdirSync(home);
  env = {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_STATE_HOME: path.join(home, 'state'),
    NO_COLOR: '1',
  };
  proj = path.join(sandbox, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"p"}\n');
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(proj, 'src', 'b.ts'), 'import { a } from "./a";\nexport const b = a;\n');
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** Run the CLI with an open, silent stdin pipe; resolves with the exit code or 'hung'. */
function run(args: string[]): Promise<number | 'hung'> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'dist', 'index.js'), ...args], {
      cwd: proj, env, stdio: ['pipe', 'ignore', 'ignore'],
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('hung'); }, TIGHT_MS);
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); child.stdin?.destroy(); resolve(code ?? -1); });
  });
}

describe('first run with a stdin pipe that never closes', () => {
  it.each([
    [['map']],
    [['strategy', 'detect']],
    [['imports']],
    [['explore']],
  ])('xray %j exits', async args => {
    expect(await run(args)).toBe(0);
  }, TIGHT_MS + 5000);
});
