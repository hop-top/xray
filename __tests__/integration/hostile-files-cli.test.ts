/**
 * End-to-end: a hostile repo (symlinks to /dev/zero, to /proc, to files
 * outside the root; a FIFO; an oversize file) neither hangs nor discloses
 * through the scanner or the strategy layer. Each case runs the built CLI
 * (and the MCP server) with a tight timeout. Requires `npm run build`.
 */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const BIN = path.join(ROOT, 'bin', 'xray');
const TIGHT_MS = 20_000;

const SECRETS = ['OUTSIDE_HEADING', 'OUTSIDE_TOKEN', 'outside_make_target', 'OUTSIDE_WORKFLOW'];

let sandbox: string;
let proj: string;
let env: NodeJS.ProcessEnv;
const posix = process.platform !== 'win32';

beforeAll(() => {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}${r.stderr}`);
  }
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hostile-')));
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

  const outside = path.join(sandbox, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'notes.md'), '# OUTSIDE_HEADING\n\ntext\n');
  fs.writeFileSync(path.join(outside, 'Dockerfile'), 'FROM node:20\nENV TOKEN=OUTSIDE_TOKEN\n');
  fs.writeFileSync(path.join(outside, 'Makefile'), 'outside_make_target:\n\techo x\n');
  fs.writeFileSync(path.join(outside, 'ci.yml'), 'name: OUTSIDE_WORKFLOW\non: push\njobs:\n  j:\n    runs-on: x\n    steps:\n      - run: echo\n');

  proj = path.join(sandbox, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.ts'), 'export function alpha(): number {\n  return 1;\n}\n');
  // Safe siblings, so the markdown / container / build / cicd strategies detect and run.
  fs.writeFileSync(path.join(proj, 'ok.md'), '# INSIDE_HEADING\n');
  fs.writeFileSync(path.join(proj, 'compose.yml'), 'services:\n  web:\n    image: nginx\n');
  fs.writeFileSync(path.join(proj, 'Justfile'), 'inside_target:\n  echo x\n');
  fs.writeFileSync(path.join(proj, '.gitlab-ci.yml'), 'inside_job:\n  script: [echo]\n');
  fs.symlinkSync('/dev/zero', path.join(proj, 'src', 'zero.ts'));
  fs.symlinkSync('/proc/self/environ', path.join(proj, 'src', 'environ.ts'));
  fs.symlinkSync('/proc/self/root/etc/passwd', path.join(proj, 'src', 'passwd.ts'));
  fs.symlinkSync(path.join(outside, 'notes.md'), path.join(proj, 'doc.md'));
  fs.symlinkSync(path.join(outside, 'Dockerfile'), path.join(proj, 'Dockerfile'));
  fs.symlinkSync(path.join(outside, 'Makefile'), path.join(proj, 'Makefile'));
  fs.symlinkSync(path.join(outside, 'ci.yml'), path.join(proj, '.github', 'workflows', 'ci.yml'));
  if (posix) {
    const mk = spawnSync('mkfifo', [path.join(proj, 'src', 'q.ts')]);
    if (mk.status !== 0) throw new Error('mkfifo failed');
    spawnSync('mkfifo', [path.join(proj, 'docs-fifo.md')]);
  }
  // Sparse 17 MiB source file: over the read cap, costs no disk.
  const big = path.join(proj, 'src', 'big.ts');
  fs.writeFileSync(big, '');
  fs.truncateSync(big, 17 * 1024 * 1024);
  spawnSync('git', ['init', '-q'], { cwd: proj, env });
  spawnSync('git', ['add', '-A'], { cwd: proj, env });
}, 300_000);

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

/** map / graph write their graph to .xray.json in the cwd, not to stdout. */
function graphFile(): string {
  try { return fs.readFileSync(path.join(proj, '.xray.json'), 'utf-8'); } catch { return ''; }
}

function run(args: string[]) {
  fs.rmSync(path.join(proj, '.xray.json'), { force: true });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: proj, env, encoding: 'utf-8', timeout: TIGHT_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024,
  });
  return { ...r, ms: Date.now() - t0, timedOut: r.error != null && (r.error as any).code === 'ETIMEDOUT' };
}

const CASES: Array<[string, string[]]> = [
  ['map', ['map', '--format', 'json']],
  ['graph', ['graph', '--format', 'json']],
  ['strategy detect', ['strategy', 'detect']],
  ['markdown toc', ['markdown', 'toc', '--format', 'json']],
  ['container analyze', ['container', 'analyze', '--format', 'json']],
  ['build targets', ['build', 'targets', '--format', 'json']],
  ['cicd workflows', ['cicd', 'workflows', '--format', 'json']],
];

describe('hostile repo through the built CLI', () => {
  it.each(CASES)('%s: finishes, exits 0, discloses nothing outside the root', (_n, args) => {
    const r = run(args);
    expect(r.timedOut).toBe(false);
    expect(r.status).toBe(0);
    for (const s of SECRETS) {
      expect(r.stdout).not.toContain(s);
      expect(r.stderr).not.toContain(s);
    }
    expect(r.stdout + r.stderr + graphFile()).not.toContain(':0:0:'); // /etc/passwd via /proc/self/root
    for (const s of SECRETS) expect(graphFile()).not.toContain(s);
  }, TIGHT_MS + 10_000);

  it.each([
    ['markdown toc', ['markdown', 'toc', '--format', 'json'], 'INSIDE_HEADING'],
    ['container analyze', ['container', 'analyze', '--format', 'json'], 'nginx'],
  ] as Array<[string, string[], string]>)('%s: still analyses the safe files', (_n, args, expected) => {
    const r = run(args);
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toContain(expected);
  }, TIGHT_MS + 10_000);

  it('map still lists the safe file, with one skip notice and counts', () => {
    const r = run(['map', '--format', 'json']);
    expect(graphFile()).toContain('src/a.ts');
    const notices = r.stderr.split('\n').filter((l) => /skipped \d+ unsafe file/.test(l));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/outside the project root/);
    if (posix) expect(notices[0]).toMatch(/not a regular file/);
  }, TIGHT_MS + 10_000);

  it('the oversize file is skipped with a notice, not read', () => {
    const r = run(['map', '--format', 'json']);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/over 16 MiB/);
    expect(graphFile()).not.toContain('big.ts');
  }, TIGHT_MS + 10_000);
});

describe('links that stay inside the root still work', () => {
  let ok: string;
  beforeAll(() => {
    ok = path.join(sandbox, 'ok');
    fs.mkdirSync(path.join(ok, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(ok, 'docs', 'real.md'), '# INSIDE_HEADING\n');
    fs.symlinkSync('docs/real.md', path.join(ok, 'README.md'));
    fs.writeFileSync(path.join(ok, 'a.ts'), 'export function alpha(): number {\n  return 1;\n}\n');
    fs.symlinkSync('a.ts', path.join(ok, 'b.ts'));
    spawnSync('git', ['init', '-q'], { cwd: ok, env });
    spawnSync('git', ['add', '-A'], { cwd: ok, env });
  });

  it('strategy reads through an in-root link', () => {
    const r = spawnSync(process.execPath, [CLI, 'markdown', 'toc', '--format', 'json'], {
      cwd: ok, env, encoding: 'utf-8', timeout: TIGHT_MS, killSignal: 'SIGKILL',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('INSIDE_HEADING');
    expect(r.stderr).not.toMatch(/unsafe file/);
  }, TIGHT_MS + 10_000);

  it('scanner keeps an in-root link to a source file', () => {
    const r = spawnSync(process.execPath, [CLI, 'map', '--format', 'json'], {
      cwd: ok, env, encoding: 'utf-8', timeout: TIGHT_MS, killSignal: 'SIGKILL',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/unsafe file/);
  }, TIGHT_MS + 10_000);
});

describe('hostile repo through the MCP server', () => {
  /** One tools/call against a server rooted at the hostile repo; kills the server on timeout. */
  function callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean; timedOut: boolean; stderr: string }> {
    return new Promise((resolve) => {
      // Own process group: a hung tool child must die with the server on timeout.
      const proc = spawn(process.execPath, [BIN, 'mcp'], { cwd: proj, env, stdio: 'pipe', detached: true });
      let buf = '';
      let stderr = '';
      let settled = false;
      const finish = (v: { text: string; isError: boolean; timedOut: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { process.kill(-proc.pid!, 'SIGKILL'); } catch { proc.kill('SIGKILL'); }
        resolve({ ...v, stderr });
      };
      const timer = setTimeout(() => finish({ text: '', isError: false, timedOut: true }), TIGHT_MS);
      proc.stderr.setEncoding('utf-8').on('data', (d: string) => (stderr += d));
      proc.stdout.setEncoding('utf-8').on('data', (d: string) => {
        buf += d;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const msg = JSON.parse(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          if (msg.id === 2) {
            const content = (msg.result?.content ?? []) as Array<{ text: string }>;
            finish({ text: content.map((c) => c.text).join('\n'), isError: !!msg.result?.isError, timedOut: false });
          }
        }
      });
      const send = (o: unknown) => proc.stdin.write(`${JSON.stringify(o)}\n`);
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    });
  }

  it.each([
    ['map', { format: 'json' }],
    ['markdown_toc', { format: 'json' }],
    ['container_analyze', { format: 'json' }],
  ] as Array<[string, Record<string, unknown>]>)('%s: finishes and discloses nothing', async (tool, args) => {
    const r = await callTool(tool, args);
    expect(r.timedOut).toBe(false);
    for (const s of SECRETS) {
      expect(r.text).not.toContain(s);
      expect(r.stderr).not.toContain(s);
    }
  }, TIGHT_MS + 10_000);
});
