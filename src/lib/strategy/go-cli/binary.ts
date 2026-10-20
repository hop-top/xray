// Opt-in toolspec path: obtain a CLI binary and ask it for its toolspec.
//
// TRUST MODEL (read before touching this file)
//   Building and running a scanned repo's code is arbitrary code execution
//   (cgo, the CLI's own init/startup code, ...). A scrubbed environment and
//   temp HOME are NOT isolation. Therefore:
//     * This module is never reached by default; static AST analysis is the
//       default. The caller must pass an explicit USER opt-in (--exec-binary,
//       --binary <path>, or the user-level env XRAY_GO_CLI_EXEC=1). Nothing
//       read from the scanned repository can enable it.
//     * Every build and run happens inside an OS sandbox (macOS sandbox-exec,
//       Linux bwrap): network denied, writes confined to a private temp dir,
//       and for the run step reads of the user's home denied except the
//       binary and the temp dir.
//     * No sandbox tool available => refuse (fall back to AST) unless the user
//       passes --unsafe-no-sandbox.
//     * Any failure fails closed: the caller falls back to AST.
//   Known limits: sandbox-exec is deprecated by Apple but functional; the
//   build step can still READ the home directory (the Go toolchain and module
//   cache live there), only writes/network are denied. The Linux bwrap path is
//   written to the same contract but is untested on this platform.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { CommandsReport } from './model';
import { parseToolspec, ToolspecParseError } from './toolspec';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBytes?: number;
}

export type Runner = (cmd: string, args: string[], opts: RunOptions) => Promise<RunResult>;

/** Run a command with stdin closed and a kill-the-group timeout. Never throws. */
export const runProcess: Runner = (cmd, args, opts) =>
  new Promise(resolve => {
    const max = opts.maxBytes ?? 16 * 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (r: RunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e: any) {
      resolve({ code: null, stdout, stderr, timedOut, spawnError: e.message });
      return;
    }
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    };
    timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    child.stdout!.on('data', d => {
      stdout += d;
      if (stdout.length > max) kill();
    });
    child.stderr!.on('data', d => {
      stderr += d;
      if (stderr.length > max) kill();
    });
    child.on('error', e => done({ code: null, stdout, stderr, timedOut, spawnError: e.message }));
    child.on('close', code => done({ code, stdout, stderr, timedOut }));
  });

// ---------------------------------------------------------------- sandbox --

export type SandboxKind = 'sandbox-exec' | 'bwrap';

export function detectSandbox(): SandboxKind | null {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) return 'sandbox-exec';
  if (process.platform === 'linux') {
    for (const dir of (process.env.PATH || '').split(':')) {
      if (dir && fs.existsSync(path.join(dir, 'bwrap'))) return 'bwrap';
    }
  }
  return null;
}

const sbq = (p: string) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * macOS SBPL profile. Last matching rule wins, so denials come before the
 * narrow allows. `readDenyHome` is set for the run step only.
 */
export function sandboxProfile(opts: {
  work: string;
  home: string;
  bin?: string;
  readDenyHome: boolean;
  writeDirs?: string[];
}): string {
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    `(allow file-write* (subpath ${sbq(opts.work)}) (literal "/dev/null") (literal "/dev/dtracehelper"))`,
  ];
  for (const w of opts.writeDirs ?? []) lines.push(`(allow file-write* (subpath ${sbq(w)}))`);
  if (opts.readDenyHome) {
    lines.push(`(deny file-read* (subpath ${sbq(opts.home)}))`);
    lines.push(`(allow file-read* (subpath ${sbq(opts.work)})${opts.bin ? ` (literal ${sbq(opts.bin)})` : ''})`);
  }
  return lines.join('\n');
}

export function wrapSandbox(
  kind: SandboxKind,
  mode: 'build' | 'run',
  p: { work: string; home: string; bin?: string; cmd: string; args: string[]; writeDirs?: string[] }
): { cmd: string; args: string[] } {
  if (kind === 'sandbox-exec') {
    const profile = sandboxProfile({
      work: p.work,
      home: p.home,
      bin: p.bin,
      readDenyHome: mode === 'run',
      writeDirs: mode === 'build' ? p.writeDirs : undefined,
    });
    return { cmd: '/usr/bin/sandbox-exec', args: ['-p', profile, p.cmd, ...p.args] };
  }
  const base = ['--die-with-parent', '--unshare-net', '--unshare-pid', '--unshare-ipc', '--dev', '/dev', '--proc', '/proc'];
  if (mode === 'build') {
    // Whole fs readable (toolchain, module cache, repo); only work dir writable.
    return {
      cmd: 'bwrap',
      args: [
        ...base, '--ro-bind', '/', '/', '--tmpfs', '/tmp', '--bind', p.work, p.work,
        ...(p.writeDirs ?? []).flatMap(w => ['--bind', w, w]),
        p.cmd, ...p.args,
      ],
    };
  }
  const ro: string[] = [];
  for (const d of ['/usr', '/lib', '/lib64', '/bin', '/sbin']) if (fs.existsSync(d)) ro.push('--ro-bind', d, d);
  return {
    cmd: 'bwrap',
    args: [
      ...base, ...ro, '--tmpfs', '/tmp', '--tmpfs', '/home', '--bind', p.work, p.work,
      '--ro-bind', p.bin!, p.bin!, p.cmd, ...p.args,
    ],
  };
}

/** Env for the sandboxed run: no inherited secrets, private HOME/XDG. */
export function sandboxEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || '/usr/bin:/bin',
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    TMPDIR: home,
    NO_COLOR: '1',
    TERM: 'dumb',
    CI: '1',
    LANG: 'C',
  };
}

// ----------------------------------------------------------------- build --

/** Locate main packages: root main.go or cmd/<name>/. Returns dirs relative to root. */
export function findMainPackages(root: string): string[] {
  const out: string[] = [];
  const isMain = (dir: string): boolean => {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return false;
    }
    return entries.some(f => {
      if (!f.endsWith('.go') || f.endsWith('_test.go')) return false;
      try {
        return /^\s*package\s+main\b/m.test(fs.readFileSync(path.join(dir, f), 'utf-8'));
      } catch {
        return false;
      }
    });
  };
  if (isMain(root)) out.push('.');
  const cmdDir = path.join(root, 'cmd');
  if (fs.existsSync(cmdDir)) {
    for (const name of fs.readdirSync(cmdDir).sort()) {
      const p = path.join(cmdDir, name);
      if (fs.statSync(p).isDirectory() && isMain(p)) out.push(`./cmd/${name}`);
    }
  }
  return out;
}

export function modulePath(root: string): string | undefined {
  try {
    return /^\s*module\s+(\S+)/m.exec(fs.readFileSync(path.join(root, 'go.mod'), 'utf-8'))?.[1];
  } catch {
    return undefined;
  }
}

/** Pick the main package to build; prefers the one named like the module. */
export function pickMainPackage(root: string, candidates: string[]): { pkg?: string; note?: string } {
  if (candidates.length === 0) return {};
  if (candidates.length === 1) return { pkg: candidates[0] };
  const modBase = modulePath(root)?.split('/').pop();
  const match = candidates.find(c => path.basename(c) === modBase);
  if (match) return { pkg: match };
  if (candidates.includes('.')) return { pkg: '.' };
  return { pkg: candidates[0], note: `multiple main packages (${candidates.join(', ')}); using ${candidates[0]}` };
}

// ------------------------------------------------------------- orchestrate --

export interface ToolspecOptions {
  /** Prebuilt binary the user supplied. */
  binary?: string;
  /** User asked to build the repo's main package and run it. */
  execBinary?: boolean;
  /** User accepted running without an OS sandbox. */
  unsafeNoSandbox?: boolean;
  buildTimeoutMs?: number;
  specTimeoutMs?: number;
  /** Persistent build cache dir (default: per-repo dir under the user cache home). */
  cacheDir?: string;
  /** Test seams. */
  runner?: Runner;
  sandbox?: SandboxKind | null;
}

export interface ToolspecOutcome {
  report?: CommandsReport;
  /** Why the toolspec path was not used. */
  reason?: string;
}

export function defaultCacheDir(root: string): string {
  const base =
    process.env.XDG_CACHE_HOME ||
    (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches') : path.join(os.homedir(), '.cache'));
  const key = crypto.createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 12);
  return path.join(base, 'xray', 'go-cli', key, 'gocache');
}

/** True when the USER (flags or user-level env) asked for execution. */
export function execRequested(opts: { binary?: unknown; execBinary?: unknown }, env = process.env): boolean {
  return !!opts.binary || !!opts.execBinary || env.XRAY_GO_CLI_EXEC === '1';
}

/** Try the toolspec path. Never throws; failure is reported via `reason`. */
export async function obtainToolspec(root: string, opts: ToolspecOptions = {}): Promise<ToolspecOutcome> {
  if (!opts.binary && !opts.execBinary) return { reason: 'execution not requested' };
  const runner = opts.runner ?? runProcess;
  const sandbox = opts.sandbox === undefined ? detectSandbox() : opts.sandbox;
  const warnings: string[] = [];
  if (!sandbox) {
    if (!opts.unsafeNoSandbox) {
      return { reason: 'no OS sandbox available (sandbox-exec/bwrap); refusing to execute. Pass --unsafe-no-sandbox to override' };
    }
    warnings.push('running UNSANDBOXED (--unsafe-no-sandbox): repo code executed with your privileges');
  }

  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-gocli-')));
  const realHome = (() => {
    try {
      return fs.realpathSync(os.homedir());
    } catch {
      return os.homedir();
    }
  })();
  // xray-managed Go build cache, one per scanned repo, so repeat runs are fast
  // and a hostile build can only poison later xray builds of that same repo.
  const wanted = opts.cacheDir ?? defaultCacheDir(root);
  fs.mkdirSync(wanted, { recursive: true });
  const cacheDir = fs.realpathSync(wanted); // sandbox rules match real paths
  const exec = (mode: 'build' | 'run', cmd: string, args: string[], o: RunOptions, bin?: string) => {
    if (!sandbox) return runner(cmd, args, o);
    const w = wrapSandbox(sandbox, mode, { work, home: realHome, bin, cmd, args, writeDirs: [cacheDir] });
    return runner(w.cmd, w.args, o);
  };

  try {
    let bin: string | undefined;
    if (opts.binary) {
      bin = fs.existsSync(opts.binary) ? fs.realpathSync(opts.binary) : undefined;
      if (!bin) return { reason: `binary not found: ${opts.binary}` };
    } else {
      const picked = pickMainPackage(root, findMainPackages(root));
      if (!picked.pkg) return { reason: 'no main package found to build' };
      if (picked.note) warnings.push(picked.note);
      const out = path.join(work, 'bin');
      const tmp = path.join(work, 'tmp');
      fs.mkdirSync(tmp, { recursive: true });
      // GOROOT/GOBIN dropped: a shell GOROOT for another toolchain breaks the
      // build ("compile: version mismatch"). No network: GOPROXY=off, module
      // cache is read-only under the sandbox. CGO is left at the Go default so
      // the build matches a plain `go build` (cgo-tagged files, C toolchain).
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.GOROOT;
      delete env.GOBIN;
      Object.assign(env, {
        GOPROXY: 'off',
        GOFLAGS: '-mod=readonly',
        GOTOOLCHAIN: 'local',
        GOTELEMETRY: 'off',
        GOCACHE: cacheDir,
        GOTMPDIR: tmp,
        TMPDIR: tmp,
      });
      const vendor = fs.existsSync(path.join(root, 'vendor')) ? '-mod=vendor' : '-mod=readonly';
      const r = await exec('build', 'go', ['build', vendor, '-o', out, picked.pkg], {
        cwd: root,
        env,
        timeoutMs: opts.buildTimeoutMs ?? 900_000,
      });
      if (r.spawnError) return { reason: `go not runnable: ${r.spawnError}` };
      if (r.timedOut) return { reason: 'go build timed out' };
      if (r.code !== 0) {
        return { reason: `go build failed (exit ${r.code}): ${r.stderr.trim().split('\n').slice(-3).join(' | ')}` };
      }
      bin = fs.realpathSync(out);
    }

    const home = path.join(work, 'home');
    for (const d of ['', '.config', '.local/share', '.cache', '.local/state']) {
      fs.mkdirSync(path.join(home, d), { recursive: true });
    }
    const r = await exec(
      'run',
      bin,
      ['spec', '--format', 'json'],
      { cwd: home, env: sandboxEnv(home), timeoutMs: opts.specTimeoutMs ?? 15_000 },
      bin
    );
    if (r.spawnError) return { reason: `could not run binary: ${r.spawnError}` };
    if (r.timedOut) return { reason: '`spec --format json` timed out' };
    if (r.code !== 0) return { reason: `\`spec --format json\` exited ${r.code} (no kit spec command?)` };
    try {
      const report = parseToolspec(r.stdout);
      report.warnings.push(...warnings);
      return { report };
    } catch (e) {
      if (e instanceof ToolspecParseError) return { reason: e.message };
      throw e;
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
