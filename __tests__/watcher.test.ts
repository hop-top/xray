import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { WorkspaceWatcher, watchGraphOptionsOf } from '../src/lib/watcher';
import { UsageError } from '../src/lib/error/types';
import { GraphCache, computeRootManifest, optionsDigest } from '../src/lib/cache/graph-cache';
import { openCacheDbPath } from '../src/lib/storage';
import type { SerializedGraph } from '../src/lib/query/types';

const writeFile = (root: string, rel: string, content: string) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
};

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 8000,
  intervalMs = 50
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
};

describe('WorkspaceWatcher and xray watch', () => {
  let repo: string;
  let cacheDir: string;
  let origCwd: string;
  let origXdgCache: string | undefined;

  beforeEach(() => {
    origCwd = process.cwd();
    origXdgCache = process.env.XDG_CACHE_HOME;
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-watch-repo-')));
    cacheDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-watch-cache-')));
    process.env.XDG_CACHE_HOME = cacheDir;

    writeFile(repo, 'package.json', '{"name":"watch-fixture"}');
    writeFile(repo, '.gitignore', 'ignored.ts\nignored-dir/\n');
    writeFile(repo, 'src/a.ts', "import { targetFn } from './b';\nexport function callerA() { return targetFn(); }\n");
    writeFile(repo, 'src/b.ts', 'export function targetFn() { return 42; }\n');
    writeFile(repo, 'src/c.ts', 'export function helperC() { return 1; }\n');
    writeFile(repo, 'src/d.ts', 'export function helperD() { return 2; }\n');
    writeFile(repo, 'src/e.ts', 'export function helperE() { return 3; }\n');
  });

  afterEach(() => {
    process.chdir(origCwd);
    if (origXdgCache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = origXdgCache;
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  test('--once warms GraphCache, writes atomic --graph-out, and exits cleanly', async () => {
    process.chdir(repo);
    const graphOut = path.join(repo, '.xray', 'graph.json');
    let updates = 0;

    const watcher = new WorkspaceWatcher({
      roots: [repo],
      cwd: repo,
      once: true,
      graphOut,
      onUpdate: () => {
        updates++;
      },
    });

    await watcher.start();

    expect(updates).toBe(1);
    expect(fs.existsSync(graphOut)).toBe(true);
    expect(fs.existsSync(`${graphOut}.tmp.${process.pid}`)).toBe(false);

    const parsed = JSON.parse(fs.readFileSync(graphOut, 'utf8')) as SerializedGraph;
    const labels = parsed.nodes.map(n => n.label);
    expect(labels).toContain('targetFn');
    expect(labels).toContain('callerA');

    // Verify GraphCache was warmed
    const manifest = computeRootManifest(repo);
    const digest = optionsDigest(watchGraphOptionsOf({
      limit: '4096',
      with: [],
      query: [],
      match: [],
      catch: [],
    }));
    const gc = new GraphCache(openCacheDbPath(repo), digest);
    try {
      const cached = gc.getRoot(repo, manifest.fingerprint);
      expect(cached).not.toBeNull();
      expect(cached!.graph.nodes.map(n => n.label)).toContain('targetFn');
    } finally {
      gc.close();
    }
  });

  test('throws UsageError when --graph-out escapes the project root', async () => {
    const outsidePath = path.join(path.dirname(repo), 'escaped-graph.json');
    const watcher = new WorkspaceWatcher({
      roots: [repo],
      cwd: repo,
      once: true,
      graphOut: outsidePath,
    });

    await expect(watcher.start()).rejects.toThrow(UsageError);
    expect(fs.existsSync(outsidePath)).toBe(false);
  });

  test('detects live edits, ignores .gitignore/.git/node_modules, debounces rapid writes, and updates --graph-out', async () => {
    process.chdir(repo);
    const graphOut = path.join(repo, '.xray', 'graph.json');
    const updateEvents: Array<{ initial: boolean; changedFiles: string[] }> = [];

    const watcher = new WorkspaceWatcher({
      roots: [repo],
      cwd: repo,
      debounceMs: 120,
      graphOut,
      onUpdate: (ev) => {
        updateEvents.push({ initial: ev.initial, changedFiles: ev.changedFiles });
      },
    });

    await watcher.start();
    try {
      expect(updateEvents).toHaveLength(1);
      expect(updateEvents[0].initial).toBe(true);

      // Ignored files should not trigger an update
      writeFile(repo, 'ignored.ts', 'export function shouldBeIgnored() {}\n');
      writeFile(repo, 'node_modules/pkg/index.ts', 'export function depFn() {}\n');
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(updateEvents).toHaveLength(1);

      // Rapid burst of edits should debounce into a single incremental update
      writeFile(repo, 'src/b.ts', 'export function intermediateOne() { return 1; }\n');
      writeFile(repo, 'src/b.ts', 'export function intermediateTwo() { return 2; }\n');
      writeFile(repo, 'src/b.ts', 'export function renamedLiveFn() { return 3; }\n');

      await waitFor(() => updateEvents.length >= 2);
      // Give extra time to ensure no trailing duplicate rebuild fires
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(updateEvents).toHaveLength(2);
      expect(updateEvents[1].initial).toBe(false);
      expect(updateEvents[1].changedFiles).toContain('src/b.ts');

      const updatedGraph = JSON.parse(fs.readFileSync(graphOut, 'utf8')) as SerializedGraph;
      const labels = updatedGraph.nodes.map(n => n.label);
      expect(labels).toContain('renamedLiveFn');
      expect(labels).not.toContain('targetFn');
      expect(fs.existsSync(`${graphOut}.tmp.${process.pid}`)).toBe(false);
    } finally {
      await watcher.stop();
    }
  });

  test('CLI xray watch --once and SIGTERM clean shutdown', async () => {
    const cliEntry = path.resolve(__dirname, '../dist/index.js');
    if (!fs.existsSync(cliEntry)) {
      throw new Error('dist/index.js not found; run npm run build first');
    }
    const graphOut = path.join(repo, '.xray', 'cli-graph.json');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XDG_CACHE_HOME: cacheDir,
      NO_COLOR: '1',
      XRAY_NO_TELEMETRY: '1',
    };

    // 1. Run --once
    const onceExit = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [cliEntry, 'watch', repo, '--once', '--graph-out', graphOut], {
        cwd: repo,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stderr }));
    });
    expect(onceExit.code).toBe(0);
    expect(fs.existsSync(graphOut)).toBe(true);

    // 2. Run live watch and terminate with SIGTERM
    const liveGraphOut = path.join(repo, '.xray', 'live-graph.json');
    const liveChild = spawn(process.execPath, [cliEntry, 'watch', repo, '--debounce', '80', '--graph-out', liveGraphOut], {
      cwd: repo,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      await waitFor(() => fs.existsSync(liveGraphOut));
      liveChild.kill('SIGTERM');
      const termCode = await new Promise<number | null>((resolve, reject) => {
        liveChild.on('error', reject);
        liveChild.on('close', code => resolve(code));
      });
      expect(termCode).toBe(0);
    } finally {
      if (!liveChild.killed) liveChild.kill('SIGKILL');
    }
  }, 15000);
});
