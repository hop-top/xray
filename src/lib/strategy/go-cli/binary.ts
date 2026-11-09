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
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import { readTextSafe } from '../../safe-read';
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
 * narrow allows. Reads of the user's home are denied for BOTH build and run;
 * `readAllow` lists the only home-resident paths that are readable again.
 */
export function sandboxProfile(opts: {
  work: string;
  home: string;
  bin?: string;
  readDenyHome: boolean;
  readAllow?: string[];
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
    const allow = [opts.work, ...(opts.readAllow ?? []), ...(opts.writeDirs ?? [])];
    lines.push(`(allow file-read* ${allow.map(a => `(subpath ${sbq(a)})`).join(' ')}${opts.bin ? ` (literal ${sbq(opts.bin)})` : ''})`);
  }
  return lines.join('\n');
}

export interface WrapParams {
  work: string;
  home: string;
  bin?: string;
  cmd: string;
  args: string[];
  writeDirs?: string[];
  /** Build only: GOROOT, GOMODCACHE, repo root, toolchain (and C toolchain if cgo). */
  readAllow?: string[];
}

export function wrapSandbox(
  kind: SandboxKind,
  mode: 'build' | 'run',
  p: WrapParams
): { cmd: string; args: string[] } {
  if (kind === 'sandbox-exec') {
    const profile = sandboxProfile({
      work: p.work,
      home: p.home,
      bin: p.bin,
      readDenyHome: true,
      readAllow: mode === 'build' ? p.readAllow : undefined,
      writeDirs: mode === 'build' ? p.writeDirs : undefined,
    });
    return { cmd: '/usr/bin/sandbox-exec', args: ['-p', profile, p.cmd, ...p.args] };
  }
  const base = ['--die-with-parent', '--unshare-net', '--unshare-pid', '--unshare-ipc', '--dev', '/dev', '--proc', '/proc'];
  // bwrap applies mounts in argument order: a later --tmpfs hides everything an
  // earlier bind put under it. The private /tmp and /home therefore come first,
  // so binds that live there (the repo, the module cache, the work dir) stay visible.
  const priv = ['--tmpfs', '/tmp', '--tmpfs', '/home'];
  const ro: string[] = [];
  for (const d of ['/usr', '/lib', '/lib64', '/bin', '/sbin', '/etc']) if (fs.existsSync(d)) ro.push('--ro-bind', d, d);
  if (mode === 'build') {
    // Only the listed paths are visible (no whole-fs bind); work + cache writable.
    const extra = (p.readAllow ?? []).filter(d => fs.existsSync(d)).flatMap(d => ['--ro-bind', d, d]);
    return {
      cmd: 'bwrap',
      args: [
        ...base, ...priv, ...ro, ...extra, '--bind', p.work, p.work,
        ...(p.writeDirs ?? []).flatMap(w => ['--bind', w, w]),
        p.cmd, ...p.args,
      ],
    };
  }
  return {
    cmd: 'bwrap',
    args: [...base, ...priv, ...ro, '--bind', p.work, p.work, '--ro-bind', p.bin!, p.bin!, p.cmd, ...p.args],
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
        return /^\s*package\s+main\b/m.test(readTextSafe(dir, f));
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
    return /^\s*module\s+(\S+)/m.exec(readTextSafe(root, 'go.mod'))?.[1];
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
  /** User opted into cgo (C toolchain runs during the build). Default off. */
  allowCgo?: boolean;
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

/** Symptoms of cgo-only files being excluded by CGO_ENABLED=0. */
const CGO_HINT = /undefined: |build constraints exclude all Go files|requires cgo|cgo: C compiler/;

/** Trusted (xray-side, unsandboxed) lookup of the Go toolchain locations to allow reading. */
export function goPaths(): { read: string[]; modcache?: string } {
  const env = { ...process.env };
  delete env.GOROOT;
  delete env.GOBIN;
  const r = spawnSync('go', ['env', 'GOROOT', 'GOMODCACHE'], { env, encoding: 'utf-8' });
  const [goroot, modcache] = r.status === 0 ? r.stdout.trim().split('\n') : [];
  const read: string[] = [];
  if (goroot) read.push(realOrSelf(goroot));
  for (const dir of (process.env.PATH || '').split(':')) {
    const g = dir && path.join(dir, 'go');
    if (g && fs.existsSync(g)) {
      read.push(path.dirname(realOrSelf(g)));
      break;
    }
  }
  return { read, modcache: modcache ? realOrSelf(modcache) : undefined };
}

function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** C toolchain locations (only readable when the user passed --allow-cgo). */
export function cToolchainPaths(): string[] {
  const out = ['/Library/Developer/CommandLineTools', '/Applications/Xcode.app', '/usr/lib', '/usr/include'];
  for (const [cmd, args] of [['xcrun', ['--show-sdk-path']], ['xcode-select', ['-p']]] as const) {
    const r = spawnSync(cmd, [...args], { encoding: 'utf-8' });
    if (r.status === 0 && r.stdout.trim()) out.push(realOrSelf(r.stdout.trim()));
  }
  return out;
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
  let readAllow: string[] = [];
  const exec = (mode: 'build' | 'run', cmd: string, args: string[], o: RunOptions, bin?: string) => {
    if (!sandbox) return runner(cmd, args, o);
    const w = wrapSandbox(sandbox, mode, { work, home: realHome, bin, cmd, args, writeDirs: [cacheDir], readAllow });
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
      // Scrubbed build env: no inherited secrets. GOROOT/GOBIN are not passed
      // (a shell GOROOT for another toolchain breaks the build with "compile:
      // version mismatch"). No network: GOPROXY=off; the module cache is
      // read-only under the sandbox. cgo (C toolchain) is OFF unless the user
      // asked for it: it lets repo code drive clang/gcc during the build.
      const goInfo = goPaths();
      const bhome = path.join(work, 'home');
      fs.mkdirSync(bhome, { recursive: true });
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH || '/usr/bin:/bin',
        HOME: bhome,
        LANG: 'C',
        NO_COLOR: '1',
        GOPROXY: 'off',
        GOFLAGS: '-mod=readonly',
        GOTOOLCHAIN: 'local',
        GOTELEMETRY: 'off',
        GOCACHE: cacheDir,
        GOTMPDIR: tmp,
        TMPDIR: tmp,
        GOPATH: path.join(work, 'gopath'),
        CGO_ENABLED: opts.allowCgo ? '1' : '0',
        // macOS: xcrun/clang/dsymutil keep a toolchain lookup cache (xcrun_db)
        // in the per-user temp dir, which the sandbox denies and unsandboxed
        // tools later trust. Point it at the build's private tmp instead.
        xcrun_db: path.join(tmp, 'xcrun_db'),
      };
      if (goInfo.modcache) env.GOMODCACHE = goInfo.modcache;
      if (opts.allowCgo) {
        for (const k of ['CC', 'CXX', 'SDKROOT', 'DEVELOPER_DIR']) if (process.env[k]) env[k] = process.env[k];
      }
      readAllow = [
        ...goInfo.read,
        goInfo.modcache,
        fs.realpathSync(root),
        ...(opts.allowCgo ? cToolchainPaths() : []),
      ].filter((x): x is string => !!x && fs.existsSync(x));
      const vendor = fs.existsSync(path.join(root, 'vendor')) ? '-mod=vendor' : '-mod=readonly';
      const r = await exec('build', 'go', ['build', vendor, '-o', out, picked.pkg], {
        cwd: root,
        env,
        timeoutMs: opts.buildTimeoutMs ?? 900_000,
      });
      if (r.spawnError) return { reason: `go not runnable: ${r.spawnError}` };
      if (r.timedOut) return { reason: 'go build timed out' };
      if (r.code !== 0) {
        const detail = r.stderr.trim().split('\n').slice(-3).join(' | ');
        if (!opts.allowCgo && CGO_HINT.test(r.stderr)) {
          return { reason: `build needs cgo; rerun with --allow-cgo (go build failed: ${detail})` };
        }
        return { reason: `go build failed (exit ${r.code}): ${detail}` };
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
