import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GraphSerializer } from '../src/lib/graph/serializer';
import { resolveContextRoots, loadConfig } from '../src/lib/config';
import { UsageError } from '../src/lib/error/types';

const Graph = require('graphology');
const CLI = path.join(__dirname, '../bin/cli.js');

describe('multi-root contexts, merged chunked maps, and global PageRank', () => {
  let base: string;
  let home: string;
  let env: NodeJS.ProcessEnv;
  let wsDir: string;
  let repoA: string;
  let repoB: string;
  let outDir: string;

  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8' });

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-root-ctx-')));
    const sub = (d: string) => {
      const p = path.join(base, '.env', d);
      fs.mkdirSync(p, { recursive: true });
      return p;
    };
    home = sub('home');
    env = {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: sub('config'),
      XDG_CACHE_HOME: sub('cache'),
      XDG_STATE_HOME: sub('state'),
      XDG_DATA_HOME: sub('data'),
      XRAY_LANG_DIR: sub('lang'),
      NO_COLOR: '1',
      XRAY_NO_TELEMETRY: '1',
    };
    delete env.XRAY_ALLOW_PROJECT_STRATEGIES;

    wsDir = path.join(base, 'workspace');
    repoA = path.join(wsDir, 'repo-a');
    repoB = path.join(wsDir, 'repo-b');
    outDir = path.join(base, 'out');

    fs.mkdirSync(path.join(repoA, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repoB, 'src'), { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    // repo-b: exports sharedHub (called by repo-a) and isolatedLeaf (uncalled)
    fs.writeFileSync(
      path.join(repoB, 'package.json'),
      JSON.stringify({ name: '@ws/repo-b', version: '1.0.0' })
    );
    fs.writeFileSync(
      path.join(repoB, 'src/hub.ts'),
      'export function sharedHub(x: number): number {\n  return x + 1;\n}\n'
    );
    fs.writeFileSync(
      path.join(repoB, 'src/isolated.ts'),
      'export function isolatedLeaf(): number {\n  return 42;\n}\n'
    );

    // repo-a: two callers importing sharedHub from @ws/repo-b
    fs.writeFileSync(
      path.join(repoA, 'src/caller1.ts'),
      "import { sharedHub } from '@ws/repo-b';\nexport function callOne(): number {\n  return sharedHub(1);\n}\n"
    );
    fs.writeFileSync(
      path.join(repoA, 'src/caller2.ts'),
      "import { sharedHub } from '@ws/repo-b';\nexport function callTwo(): number {\n  return sharedHub(2);\n}\n"
    );

    // Global user config defining workspace context
    fs.writeFileSync(
      path.join(home, '.xrayrc.json'),
      JSON.stringify({
        contexts: {
          ws: {
            include: [path.join(wsDir, '*')],
          },
        },
      })
    );
  });

  afterAll(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('GraphSerializer node community preservation', () => {
    it('preserves node community attribute through serialize/deserialize', () => {
      const graph = new Graph({ multi: true, type: 'directed' });
      graph.addNode('src/a.ts', { type: 'file', label: 'a.ts', community: 2 });
      graph.addNode('src/a.ts::fn', {
        type: 'tag',
        label: 'fn',
        kind: 'function',
        file: 'src/a.ts',
        line: 0,
        community: 2,
      });

      const serializer = new GraphSerializer();
      const serialized = serializer.serialize(graph, '/proj');
      const fileNode = serialized.nodes.find((n) => n.id === 'src/a.ts');
      const tagNode = serialized.nodes.find((n) => n.id === 'src/a.ts::fn');
      expect((fileNode as any).community).toBe(2);
      expect((tagNode as any).community).toBe(2);

      const restored = serializer.deserialize(serialized);
      expect(restored.getNodeAttribute('src/a.ts', 'community')).toBe(2);
      expect(restored.getNodeAttribute('src/a.ts::fn', 'community')).toBe(2);
    });
  });

  describe('resolveContextRoots and confinement', () => {
    it('resolves globs and excludes matching patterns', () => {
      const mono = path.join(base, 'monorepo');
      fs.mkdirSync(path.join(mono, 'packages/alpha'), { recursive: true });
      fs.mkdirSync(path.join(mono, 'packages/beta'), { recursive: true });
      fs.mkdirSync(path.join(mono, 'packages/legacy'), { recursive: true });
      const config = {
        contexts: {
          active: {
            include: ['packages/*'],
            exclude: ['packages/legacy'],
          },
        },
      };
      const roots = resolveContextRoots(config, 'active', mono);
      expect(roots).toEqual([
        path.join(mono, 'packages/alpha'),
        path.join(mono, 'packages/beta'),
      ]);
    });

    it('confines repo-local contexts inside the project directory', () => {
      const proj = path.join(base, 'confined-proj');
      fs.mkdirSync(proj, { recursive: true });
      const cfgPath = path.join(proj, '.xrayrc.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          contexts: {
            bad: { include: ['../workspace/*'] },
          },
        })
      );
      expect(() =>
        loadConfig(cfgPath, undefined, {
          resolvePaths: true,
          confine: { paths: false, output: true, queries: true, share: true, context: 'bad' },
        })
      ).toThrow(UsageError);
    });
  });

  describe('--context exclusivity UsageError', () => {
    it('rejects --context combined with positional paths, --path, --scope, --all-scopes, or --graph', () => {
      const cases: string[][] = [
        ['map', '--context', 'ws', repoA],
        ['map', '--context', 'ws', '--path', repoA],
        ['map', '--context', 'ws', '--scope', 's1'],
        ['map', '--context', 'ws', '--all-scopes'],
        ['map', '--flow', '--context', 'ws', '--path', repoA],
        ['impact', 'sharedHub', '--context', 'ws', '--graph', 'g.json'],
        ['impact', 'sharedHub', '--context', 'ws', '--path', repoA],
        ['query', 'calls(sharedHub)', '--context', 'ws', '--graph', 'g.json'],
        ['explore', '--context', 'ws', '--path', repoA],
      ];
      for (const args of cases) {
        const res = run(base, ...args);
        expect(res.status).toBe(2);
        expect(res.stderr).toContain('exclusive');
      }
    });
  });

  describe('2-repo merged chunked map, global PageRank, and CLI commands', () => {
    it('writes non-colliding root-prefixed .xray_*.md chunks and ranks cross-repo hub above isolated leaf', () => {
      const outBase = path.join(outDir, '.xray.md');
      const res = run(base, 'map', '--context', 'ws', '-o', outBase, '--no-detect');
      expect(res.status).toBe(0);

      const files = fs.readdirSync(outDir).filter((f) => f.startsWith('.xray_') && f.endsWith('.md'));
      expect(files).toContain('.xray_workspace-repo-a_src.md');
      expect(files).toContain('.xray_workspace-repo-b_src.md');

      // In repo-b's chunk, files are ordered by global PageRank descending.
      // sharedHub receives cross-repo calls from repo-a, so hub.ts must rank above isolated.ts.
      const repoBContent = fs.readFileSync(path.join(outDir, '.xray_workspace-repo-b_src.md'), 'utf8');
      const hubIdx = repoBContent.indexOf('workspace-repo-b/src/hub.ts');
      const isolatedIdx = repoBContent.indexOf('workspace-repo-b/src/isolated.ts');
      expect(hubIdx).toBeGreaterThan(-1);
      expect(isolatedIdx).toBeGreaterThan(-1);
      expect(hubIdx).toBeLessThan(isolatedIdx);
    });

    it('supports --group community with --context across multiple roots', () => {
      const commDir = path.join(base, 'out-community');
      fs.mkdirSync(commDir, { recursive: true });
      const res = run(
        base,
        'map',
        '--context',
        'ws',
        '--group',
        'community',
        '-o',
        path.join(commDir, '.xray.md'),
        '--no-detect'
      );
      expect(res.status).toBe(0);
      const files = fs.readdirSync(commDir).filter((f) => f.startsWith('.xray_') && f.endsWith('.md'));
      expect(files).toContain('.xray_root.md');
      expect(files.length).toBeGreaterThanOrEqual(2);
    });

    it('supports --context in impact, query, and explore', () => {
      const impactRes = run(base, 'impact', 'sharedHub', '--context', 'ws', '--format', 'json');
      expect(impactRes.status).toBe(0);
      const impactJson = JSON.parse(impactRes.stdout);
      const callerNames = impactJson.nodes.map((n: any) => n.name);
      expect(callerNames).toEqual(expect.arrayContaining(['callOne', 'callTwo']));

      const queryRes = run(base, 'query', 'callers(sharedHub)', '--context', 'ws', '--format', 'json');
      expect(queryRes.status).toBe(0);
      const queryJson = JSON.parse(queryRes.stdout);
      const queryNames = queryJson.nodes.map((n: any) => n.name);
      expect(queryNames).toEqual(expect.arrayContaining(['callOne', 'callTwo']));

      const exploreRes = run(base, 'explore', '--context', 'ws', '--match', '*.ts', '--format', 'json');
      expect(exploreRes.status).toBe(0);
      const exploreJson = JSON.parse(exploreRes.stdout);
      const matchedPaths = exploreJson.map((r: any) => r.path);
      expect(matchedPaths.some((p: string) => p.includes('repo-a'))).toBe(true);
      expect(matchedPaths.some((p: string) => p.includes('repo-b'))).toBe(true);
    });
  });
});
