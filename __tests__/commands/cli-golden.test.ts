/**
 * Golden baseline of the CLI surface, captured by spawning the built bin.
 *
 * Covers: --help for root + every (sub)command, describe, paths,
 * completion scripts, map/query/explore on a fixture repo, and exit code
 * + stderr shape of common error paths. Any drift fails here; intentional
 * drift = regenerate goldens in the same commit and call it out.
 *
 * Update goldens:
 *   npm run build && npx jest -u __tests__/commands/cli-golden.test.ts
 *
 * Determinism: clean env (HOME/XDG_* in a tmp sandbox, NO_COLOR, no
 * inherited XRAY_* vars), fresh tmp cwd per spawn, output normalized for
 * tmp paths, repo root, ANSI, timestamps and timings.
 */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');
const DIST_ENTRY = path.join(ROOT, 'dist', 'index.js');
const FIXTURE = path.join(ROOT, '__tests__', 'fixtures', 'plumbing');
const PKG_VERSION: string = require('../../package.json').version;

// Every command path whose --help is pinned; [] is the root. Hidden
// commands (clear-cache) included on purpose.
const COMMANDS: string[][] = [
  [],
  ['map'], ['graph'], ['query'], ['explore'], ['imports'],
  ['strategy'],
  ['strategy', 'list'], ['strategy', 'detect'], ['strategy', 'info'],
  ['strategy', 'create'], ['strategy', 'install'], ['strategy', 'remove'],
  ['strategy', 'validate'], ['strategy', 'path'],
  ['alias'], ['alias', 'list'], ['alias', 'set'], ['alias', 'remove'],
  ['lang'], ['lang', 'list'], ['lang', 'add'], ['lang', 'remove'],
  ['cache'], ['cache', 'clear'], ['clear-cache'],
  ['paths'], ['describe'], ['upgrade'], ['mcp'], ['completion'], ['help'],
  ['build'], ['build', 'targets'], ['build', 'graph'], ['build', 'run'], ['build', 'exec'],
  ['cicd'], ['cicd', 'workflows'], ['cicd', 'graph'], ['cicd', 'deploy'],
  ['cicd', 'triggers'],
  ['config-files'], ['config-files', 'list'], ['config-files', 'keys'], ['config-files', 'values'],
  ['config'], ['config', 'list'],
  ['container'], ['container', 'analyze'], ['container', 'services'],
  ['container', 'stages'],
  ['express'], ['express', 'routes'], ['express', 'routers'],
  ['express', 'middleware'], ['express', 'error-handlers'],
  ['go-cli'], ['go-cli', 'commands'],
  ['infrastructure'], ['infrastructure', 'resources'],
  ['infrastructure', 'providers'], ['infrastructure', 'graph'],
  ['infrastructure', 'summary'], ['infrastructure', 'validate'],
  ['markdown'], ['markdown', 'toc'], ['markdown', 'refs'],
  ['markdown', 'orphans'], ['markdown', 'code-refs'],
  ['markdown', 'coverage'], ['markdown', 'stale'],
  ['package-manager'], ['package-manager', 'list-dependencies'],
  ['package-manager', 'summary'],
  ['react'], ['react', 'components'], ['react', 'hooks'], ['react', 'contexts'],
  ['rest-api'], ['rest-api', 'endpoints'], ['rest-api', 'methods'],
  ['rest-api', 'middleware'],
];

const ERROR_CASES: string[][] = [
  ['nosuchcmd-x'], // unknown command (hyphenated)
  ['mpa'], // near-miss typo
  ['scan'], // removed command
  ['--bogus'], // unknown root flag
  ['map', '--bogus'], // unknown subcommand flag
  ['query'], // missing optional-but-required query
  ['query', '--format', 'json', '--graph', '/nonexistent/g.json', '--path', '/tmp', 'calls(x)'], // --graph with --path
  ['query', '--graph', '/nonexistent/g.json', 'calls(x)'], // not found
  ['strategy', 'info'], // missing required arg
  ['alias', 'remove'],
  ['lang', 'add'],
  ['completion'],
  ['completion', 'pwsh'], // unsupported shell
  ['help', 'nosuch'], // help for unknown command
];

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

let sandbox: string;
let sandboxReal: string;
let env: NodeJS.ProcessEnv;

function cleanEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    XRAY_NO_TELEMETRY: '1',
    LANG: 'C',
    TZ: 'UTC',
  };
}

let cwdSeq = 0;
// Fresh cwd per spawn: first run writes .xray/ strategy cache into cwd; isolating avoids races/ordering.
// Realpath padded to a fixed length: help embeds cwd as an option default,
// and commander wraps by length, so tmpdir length must not leak into goldens.
const CWD_LEN = 200;
function freshCwd(): string {
  const prefix = path.join(sandboxReal, 'cwd', `${cwdSeq++}-`);
  const pad = CWD_LEN - prefix.length;
  if (pad < 1) throw new Error(`tmpdir too long for fixed-length cwd: ${prefix}`);
  const dir = prefix + 'x'.repeat(pad);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function run(args: string[], cwd: string = freshCwd()): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf-8').on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function runAll(cases: string[][], concurrency = 8): Promise<Result[]> {
  const out: Result[] = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      out[i] = await run(cases[i]);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

function normalize(s: string): string {
  // realpath first: on macOS /private/var/... contains /var/...
  return s
    .split(sandboxReal).join('<TMP>')
    .split(sandbox).join('<TMP>')
    .split(ROOT).join('<ROOT>')
    .replace(ANSI_RE, '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<TIMESTAMP>')
    .replace(/"executionTime": \d+/g, '"executionTime": <N>')
    .replace(/\b\d+(?:\.\d+)?ms\b/g, '<N>ms')
    .replace(/<TMP>\/cwd\/\d+-x+/g, '<CWD>')
    // Per-project storage key: a hash of the (random) sandbox cwd.
    .replace(/\/(projects|telemetry)\/[0-9a-f]{16}\//g, '/$1/<KEY>/');
}

function golden(r: Result): string {
  return [
    `exit: ${r.status}`,
    '--- stdout ---',
    normalize(r.stdout),
    '--- stderr ---',
    normalize(r.stderr),
  ].join('\n');
}

beforeAll(() => {
  if (!fs.existsSync(DIST_ENTRY)) {
    const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}${r.stderr}`);
  }
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-golden-'));
  sandboxReal = fs.realpathSync(sandbox);
  const home = path.join(sandbox, 'home');
  fs.mkdirSync(home, { recursive: true });
  env = cleanEnv(home);
}, 300_000);

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('cli golden: --help', () => {
  let results: Map<string, Result>;

  beforeAll(async () => {
    const rs = await runAll(COMMANDS.map((c) => [...c, '--help']));
    results = new Map(COMMANDS.map((c, i) => [c.join(' '), rs[i]]));
  }, 120_000);

  it.each(COMMANDS.map((c) => [c.length ? c.join(' ') : '(root)', c.join(' ')]))(
    'xray %s --help',
    (_label, key) => {
      const r = results.get(key)!;
      expect(r.status).toBe(0);
      expect(golden(r)).toMatchSnapshot();
    }
  );
});

// Surplus positionals are a usage error (exit 2), explore included: it
// takes no query (only a bare `xray <path>` is routed to it).
const EXCESS_ARG_REJECTED: string[][] = [
  ['explore', 'q', 'extra'], // no query operand
  ['strategy', 'info', 'express', 'extra'], // required arg + surplus
  ['paths', 'extra'], // no-arg command
];

describe('cli golden: excess arguments', () => {
  it.each(EXCESS_ARG_REJECTED.map((c) => [c.join(' '), c]))(
    'xray %s is a usage error',
    async (_label, args) => {
      const r = await run(args as string[]);
      expect(r.status).toBe(2);
      expect(golden(r)).toMatchSnapshot();
    }
  );
});

describe('cli golden: introspection', () => {
  it('--version', async () => {
    const r = await run(['--version']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`xray v${PKG_VERSION}`);
    expect(r.stderr).toBe('');
  });

  it('describe', async () => {
    const r = await run(['describe']);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const doc = JSON.parse(r.stdout);
    expect(doc.version).toBe(PKG_VERSION);
    doc.version = '<VERSION>';
    expect(normalize(JSON.stringify(doc, null, 2))).toMatchSnapshot();
  });

  it.each([['text'], ['json']])('paths --format %s', async (format) => {
    const r = await run(['paths', '--format', format]);
    expect(golden(r)).toMatchSnapshot();
  });

  it.each([['bash'], ['zsh'], ['fish'], ['powershell']])('completion %s', async (shell) => {
    const r = await run(['completion', shell]);
    expect(r.status).toBe(0);
    expect(golden(r)).toMatchSnapshot();
  });
});

describe('cli golden: error paths', () => {
  let results: Result[];

  beforeAll(async () => {
    results = await runAll(ERROR_CASES);
  }, 120_000);

  it.each(ERROR_CASES.map((c, i) => [c.join(' '), i]))('xray %s', (_label, i) => {
    expect(golden(results[i as number])).toMatchSnapshot();
  });
});

describe('cli golden: map / query / explore on fixture repo', () => {
  let repo: string;
  let outDir: string;
  let graphFile: string;

  beforeAll(async () => {
    repo = path.join(sandbox, 'repo');
    outDir = path.join(sandbox, 'out');
    fs.cpSync(FIXTURE, repo, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    // git-backed file listing (no "not a git repository" fallback warning)
    const g = spawnSync('git', ['init', '-q'], { cwd: repo, env, encoding: 'utf-8' });
    if (g.status !== 0) throw new Error(`git init failed: ${g.stderr}`);
    graphFile = path.join(outDir, 'graph.json');
  }, 60_000);

  it('map --no-chunk --txt', async () => {
    const out = path.join(outDir, 'single.txt');
    const r = await run(['map', '--skip-detect', '--no-chunk', '--txt', '-o', out], repo);
    expect(golden(r)).toMatchSnapshot();
    expect(normalize(fs.readFileSync(out, 'utf-8'))).toMatchSnapshot();
  }, 60_000);

  it('map --txt (chunked)', async () => {
    const base = path.join(outDir, 'chunks');
    const r = await run(['map', '--skip-detect', '--txt', '-o', base], repo);
    expect(golden(r)).toMatchSnapshot();
    const files = fs.readdirSync(outDir).filter((f) => f.startsWith('chunks')).sort();
    const contents = files.map(
      (f) => `== ${f} ==\n${normalize(fs.readFileSync(path.join(outDir, f), 'utf-8'))}`
    );
    expect(contents.join('\n')).toMatchSnapshot();
  }, 60_000);

  it('map --format json', async () => {
    const r = await run(['map', '--skip-detect', '--format', 'json', '-o', graphFile], repo);
    expect(golden(r)).toMatchSnapshot();
    expect(normalize(fs.readFileSync(graphFile, 'utf-8'))).toMatchSnapshot();
  }, 60_000);

  it.each([
    ['table', 'calls(beta)'],
    ['json', 'callers(alpha)'],
    ['tree', 'calls(gamma)'],
  ])('query --format %s %s', async (format, q) => {
    expect(fs.existsSync(graphFile)).toBe(true);
    const r = await run(['query', '--graph', graphFile, '--format', format, q], repo);
    expect(golden(r)).toMatchSnapshot();
  }, 60_000);

  it.each([
    [['explore', '--stats']],
    [['explore', '-s', 'alpha']],
    [['explore', '-m', '*.ts']],
    [['explore', 'beta']],
    [['beta']], // not a command: usage error, never the default command
  ])('%j', async (args) => {
    const r = await run(args, repo);
    expect(golden(r)).toMatchSnapshot();
  }, 60_000);
});
