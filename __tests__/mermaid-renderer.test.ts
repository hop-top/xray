import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Graph from 'graphology';
import { renderMermaid } from '../src/lib/renderer/mermaid-renderer';
import { resolveFormatFlags } from '../src/lib/output-format';
import { resolveOutputPath } from '../src/commands/common';
import { generateHandbook } from '../src/lib/handbook/generator';
import { Confidence, XrayGraph } from '../src/types/graph';

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'xray');

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

function buildSampleGraph(): XrayGraph {
  const g: XrayGraph = new Graph({ multi: true, type: 'directed' });
  g.addNode('src/auth/token.ts', {
    type: 'file',
    label: 'src/auth/token.ts',
    community: 0,
    rank: 0.9,
  });
  g.addNode('src/crypto/hash.ts', {
    type: 'file',
    label: 'src/crypto/hash.ts',
    community: 1,
    rank: 0.8,
  });
  g.addNode('src/auth/token.ts:signToken', {
    type: 'tag',
    label: 'signToken(user: string): string [auth]',
    kind: 'function',
    file: 'src/auth/token.ts',
    line: 10,
    community: 0,
    rank: 0.95,
    cfg: {
      nodes: [
        { id: 'n0', kind: 'entry', label: 'entry', line: 10 },
        { id: 'n2', kind: 'cond', label: 'if (!user)', line: 11 },
        { id: 'n3', kind: 'throw', label: 'throw new Error("missing")', line: 12 },
        { id: 'n4', kind: 'return', label: 'return hashSecret(user)', line: 14 },
        { id: 'n1', kind: 'exit', label: 'exit', line: 15 },
      ],
      edges: [
        { from: 'n0', to: 'n2' },
        { from: 'n2', to: 'n3', label: 'true' },
        { from: 'n2', to: 'n4', label: 'false' },
        { from: 'n3', to: 'n1', label: 'throw' },
        { from: 'n4', to: 'n1' },
      ],
    },
    dfg: {
      nodes: [
        { id: 'd0', name: 'user', kind: 'param', line: 10, at: 'n0' },
        { id: 'd1', name: 'digest', kind: 'decl', line: 14, at: 'n4' },
      ],
      sites: [
        { id: 'n2', line: 11, label: 'if (!user)' },
        { id: 'n4', line: 14, label: 'return hashSecret(user)' },
      ],
      edges: [
        { from: 'd0', to: 'n2' },
        { from: 'd0', to: 'n4' },
      ],
    },
  });
  g.addNode('src/crypto/hash.ts:hashSecret', {
    type: 'tag',
    label: 'hashSecret("raw") <b>helper</b>',
    kind: 'function',
    file: 'src/crypto/hash.ts',
    line: 3,
    community: 1,
    rank: 0.85,
  });
  g.addNode('src/crypto/hash.ts:maybeHelper', {
    type: 'tag',
    label: 'maybeHelper',
    kind: 'function',
    file: 'src/crypto/hash.ts',
    line: 12,
    community: 1,
    rank: 0.4,
  });

  g.addEdge('src/auth/token.ts', 'src/auth/token.ts:signToken', { type: 'defines' });
  g.addEdge('src/crypto/hash.ts', 'src/crypto/hash.ts:hashSecret', { type: 'defines' });
  g.addEdge('src/crypto/hash.ts', 'src/crypto/hash.ts:maybeHelper', { type: 'defines' });
  g.addEdge('src/auth/token.ts', 'src/crypto/hash.ts', {
    type: 'imports',
    confidence: Confidence.EXTRACTED,
  });
  g.addEdge('src/auth/token.ts:signToken', 'src/crypto/hash.ts:hashSecret', {
    type: 'calls',
    confidence: Confidence.EXTRACTED,
  });
  g.addEdge('src/auth/token.ts:signToken', 'src/crypto/hash.ts:maybeHelper', {
    type: 'calls',
    confidence: Confidence.INFERRED,
  });

  return g;
}

describe('mermaid-renderer', () => {
  test('architecture view emits flowchart LR with balanced community subgraphs', () => {
    const g = buildSampleGraph();
    const mmd = renderMermaid(g, { view: 'architecture' });

    expect(mmd.startsWith('flowchart LR\n')).toBe(true);
    expect(mmd).toContain('subgraph community_0[');
    expect(mmd).toContain('subgraph community_1[');
    const subgraphs = countMatches(mmd, /^\s*subgraph\s+/gm);
    const ends = countMatches(mmd, /^\s*end\s*$/gm);
    expect(subgraphs).toBeGreaterThanOrEqual(2);
    expect(subgraphs).toBe(ends);
    expect(mmd).toContain('-->');
  });

  test('sanitizes colliding node IDs and double-quotes labels with parens, brackets, quotes, and HTML stripped', () => {
    const g: XrayGraph = new Graph({ multi: false, type: 'directed' });
    g.addNode('a-b.ts', { type: 'file', label: 'a-b.ts (v1) [core]', rank: 0.9 });
    g.addNode('a/b.ts', { type: 'file', label: 'a/b.ts "quoted" <script>alert(1)</script>', rank: 0.8 });
    g.addEdge('a-b.ts', 'a/b.ts', { type: 'imports', confidence: Confidence.EXTRACTED });

    const mmd = renderMermaid(g, { view: 'architecture' });
    // Extract node definition lines: <id>["<label>"]
    const nodeLines = mmd.split('\n').filter((l) => /\[".*"\]/.test(l) && !/^\s*subgraph\s/.test(l));
    expect(nodeLines.length).toBe(2);

    const ids = nodeLines.map((l) => l.trim().split('[')[0]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_]+$/);
    }

    expect(mmd).toContain('["a-b.ts (v1) [core]"]');
    expect(mmd).not.toContain('<script>');
    expect(mmd).not.toContain('</script>');
    expect(mmd).toContain('\\"quoted\\"');
  });

  test('calls view emits flowchart TD with solid --> for EXTRACTED and dashed -.-> for INFERRED', () => {
    const g = buildSampleGraph();
    const mmd = renderMermaid(g, { view: 'calls' });

    expect(mmd.startsWith('flowchart TD\n')).toBe(true);
    expect(mmd).toContain('-->');
    expect(mmd).toContain('-.->');
    expect(mmd).not.toContain('<b>');
  });

  test('enforces maxNodes cap with top-ranked selection and BFS from anchor within depth', () => {
    const g: XrayGraph = new Graph({ multi: true, type: 'directed' });
    for (let i = 0; i < 10; i++) {
      g.addNode(`fn_${i}`, {
        type: 'tag',
        label: `fn_${i}`,
        kind: 'function',
        file: 'src/a.ts',
        line: i + 1,
        rank: (10 - i) / 10,
      });
    }
    for (let i = 0; i < 9; i++) {
      g.addEdge(`fn_${i}`, `fn_${i + 1}`, { type: 'calls', confidence: Confidence.EXTRACTED });
    }

    const capped = renderMermaid(g, { view: 'calls', maxNodes: 4 });
    expect(capped).toContain('%% truncated: 6 nodes omitted');
    const renderedNodes = capped.split('\n').filter((l) => /^\s*[A-Za-z0-9_]+\["fn_\d+"\]/.test(l));
    expect(renderedNodes.length).toBe(4);

    const bfs = renderMermaid(g, { view: 'calls', anchor: 'fn_0', depth: 2, maxNodes: 60 });
    expect(bfs).toContain('fn_0');
    expect(bfs).toContain('fn_1');
    expect(bfs).toContain('fn_2');
    expect(bfs).not.toContain('fn_3');
  });

  test('cfg and dfg views render intra-procedural graphs for functions matched by --catch / --anchor', () => {
    const g = buildSampleGraph();

    const cfgMmd = renderMermaid(g, { view: 'cfg', catch: ['signToken'] });
    expect(cfgMmd.startsWith('flowchart TD\n')).toBe(true);
    expect(cfgMmd).toContain('subgraph ');
    expect(cfgMmd).toContain('|"true"|');
    expect(cfgMmd).toContain('|"false"|');
    expect(cfgMmd).toContain('|"throw"|');
    expect(countMatches(cfgMmd, /^\s*subgraph\s+/gm)).toBe(countMatches(cfgMmd, /^\s*end\s*$/gm));

    const dfgMmd = renderMermaid(g, { view: 'dfg', catch: ['signToken'] });
    expect(dfgMmd.startsWith('flowchart TD\n')).toBe(true);
    expect(dfgMmd).toContain('user (param)');
    expect(dfgMmd).toContain('return hashSecret(user)');
    expect(dfgMmd).toContain('-->');
    expect(countMatches(dfgMmd, /^\s*subgraph\s+/gm)).toBe(countMatches(dfgMmd, /^\s*end\s*$/gm));
  });
});

describe('mermaid format resolution and CLI integration', () => {
  test('resolveFormatFlags and resolveOutputPath support mermaid / .mmd', () => {
    expect(resolveFormatFlags({ format: 'mermaid' })).toEqual({ format: 'mermaid' });
    expect(resolveFormatFlags({ mermaid: true })).toEqual({ format: 'mermaid' });
    expect(resolveOutputPath(undefined, 'mermaid')).toMatch(/[/\\]\.xray[/\\]maps[/\\]map\.mmd$/);
    expect(resolveOutputPath(undefined, 'mermaid', true, 'graph')).toMatch(/[/\\]\.xray[/\\]graphs[/\\]graph\.mmd$/);
    expect(resolveOutputPath('diagram-out', 'mermaid')).toMatch(/diagram-out\.mmd$/);
  });

  test('xray map --format mermaid, xray diagram, and xray handbook integration', async () => {
    const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-mmd-cli-')));
    const repoDir = path.join(sandbox, 'repo');
    const outBase = path.join(sandbox, 'out');
    fs.mkdirSync(path.join(repoDir, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'src', 'crypto'), { recursive: true });

    fs.writeFileSync(
      path.join(repoDir, 'src', 'crypto', 'hash.ts'),
      'export function hashSecret(x: string): string {\n  return x.trim();\n}\n'
    );
    fs.writeFileSync(
      path.join(repoDir, 'src', 'auth', 'token.ts'),
      "import { hashSecret } from '../crypto/hash';\nexport function signToken(id: string): string {\n  if (!id) throw new Error('empty');\n  return hashSecret(id);\n}\n"
    );

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      XRAY_NO_TELEMETRY: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      XDG_CACHE_HOME: path.join(sandbox, 'cache'),
    };

    execFileSync('git', ['init', '-q'], { cwd: repoDir, env });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, env });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, env });
    execFileSync('git', ['add', '.'], { cwd: repoDir, env });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, env });

    try {
      // 1. xray map --format mermaid -o <outBase> -> <outBase>.mmd
      const mapRes = spawnSync(
        process.execPath,
        [BIN, 'map', '-p', repoDir, '--skip-detect', '--format', 'mermaid', '-o', outBase],
        { cwd: repoDir, env, encoding: 'utf-8' }
      );
      expect(mapRes.status).toBe(0);
      expect(fs.existsSync(`${outBase}.mmd`)).toBe(true);
      const mapMmd = fs.readFileSync(`${outBase}.mmd`, 'utf-8');
      expect(mapMmd).toMatch(/^flowchart LR\n/);

      // 2. xray diagram --view calls
      const diagCalls = spawnSync(
        process.execPath,
        [BIN, 'diagram', repoDir, '--view', 'calls', '--max-nodes', '10'],
        { cwd: repoDir, env, encoding: 'utf-8' }
      );
      expect(diagCalls.status).toBe(0);
      expect(diagCalls.stdout).toMatch(/^flowchart TD\n/);
      expect(diagCalls.stdout).toContain('signToken');

      // 3. xray diagram --view cfg --catch signToken
      const diagCfg = spawnSync(
        process.execPath,
        [BIN, 'diagram', repoDir, '--view', 'cfg', '--catch', 'signToken'],
        { cwd: repoDir, env, encoding: 'utf-8' }
      );
      expect(diagCfg.status).toBe(0);
      expect(diagCfg.stdout).toMatch(/^flowchart TD\n/);
      expect(diagCfg.stdout).toContain('subgraph ');

      // 4. handbook generator embeds ```mermaid block in subsystem pages
      const hb = await generateHandbook({ root: repoDir });
      const subPages = hb.files.filter((f) => path.basename(f) !== 'README.md');
      expect(subPages.length).toBeGreaterThan(0);
      for (const page of subPages) {
        const md = fs.readFileSync(page, 'utf-8');
        expect(md).toContain('```mermaid\nflowchart LR');
        expect(md).toContain('\n```\n');
      }
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
