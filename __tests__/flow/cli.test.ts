/**
 * `map` / `graph` flow plumbing through the built CLI (bin/cli.js ->
 * dist): which flags put cfg/dfg where, formats, cache transitions between
 * flag sets, and languages without flow support.
 *
 * Requires `npm run build` first (dist/ is what ships).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.join(__dirname, '../../bin/cli.js');

const SUM = `export function sum(xs: number[], limit: number): number {
  let total = 0;
  for (const x of xs) {
    if (x > limit) { break; }
    total += x;
  }
  return total;
}

export class Acc {
  add(n: number) {
    return n + 1;
  }
}
`;

describe('map / graph flow flags through the built CLI', () => {
  let home: string;
  let proj: string;

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-cli-home-'));
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-cli-proj-'));
    fs.writeFileSync(path.join(proj, 'a.ts'), SUM);
    fs.writeFileSync(path.join(proj, 'b.rs'), 'fn rs_fn(x: i32) -> i32 {\n    x\n}\n');
  });
  afterAll(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(proj, { recursive: true, force: true });
  });

  const run = (args: string[], cwd = proj) =>
    spawnSync('node', [CLI, '--no-telemetry', '--offline', ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, 'config'),
        XDG_DATA_HOME: path.join(home, 'data'),
        XDG_CACHE_HOME: path.join(home, 'cache'),
        XDG_STATE_HOME: path.join(home, 'state'),
        NO_COLOR: '1',
      },
      encoding: 'utf8',
    });

  const text = (args: string[], file = 'out.txt') => {
    const out = path.join(proj, file);
    fs.rmSync(out, { force: true });
    const r = run([...args, '--no-chunk', '-o', out]);
    return { r, out: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '' };
  };
  const json = (args: string[], file = 'g.json') => {
    const out = path.join(proj, file);
    fs.rmSync(out, { force: true });
    const r = run([...args, '--format', 'json', '-o', out]);
    const g = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : undefined;
    const tag = (name: string) => g?.nodes.find((n: any) => n.id === `a.ts::${name}`);
    return { r, g, tag };
  };

  describe('text', () => {
    it('plain map: no flow, exactly the lines it always had', () => {
      const { r, out } = text(['map']);
      expect(r.status).toBe(0);
      expect(out).not.toMatch(/\bcfg\b|\bdfg\b/);
      expect(out).toContain('│ [L1-L8] function sum(xs: number[], limit: number) : number');
    });

    it('map --with cf: cfg only, under the function', () => {
      const { out } = text(['map', '--with', 'cf']);
      expect(out).toContain('│   cfg\n│     n0 entry L1 → n2');
      expect(out).not.toContain('dfg');
    });

    it('map --with df: dfg only, self-contained (reading nodes listed)', () => {
      const { out } = text(['map', '--with', 'df']);
      expect(out).toContain('│   dfg\n│     n3 L3 for (const x of xs)');
      expect(out).toContain('d2 total decl L2 → n6 n7');
      expect(out).not.toContain('│   cfg');
    });

    it('methods get graphs too', () => {
      const { out } = text(['map', '--with', 'cf']);
      expect(out).toContain('method add(n: number)');
      expect(out).toMatch(/return L12 return n \+ 1 → n1/);
    });

    it('graph = map with cf and df on', () => {
      const { out } = text(['graph']);
      expect(out).toContain('│   cfg');
      expect(out).toContain('│   dfg');
    });

    it('an explicit --with wins over config features: config df never adds flow back', () => {
      const rc = path.join(proj, '.xrayrc.json');
      fs.writeFileSync(rc, JSON.stringify({ features: { df: true } }));
      try {
        expect(text(['graph', '--with', 'cf']).out).not.toContain('dfg');
        expect(text(['map', '--with', 'cf']).out).not.toContain('dfg');
        expect(text(['map', '--with', 'df']).out).not.toContain('│   cfg');
        expect(text(['map']).out).toContain('dfg');
      } finally {
        fs.rmSync(rc, { force: true });
      }
    });

    it('graph --with cf narrows to cf; --with df to df; other features add to the default', () => {
      expect(text(['graph', '--with', 'cf']).out).not.toContain('dfg');
      expect(text(['graph', '--with', 'df']).out).not.toContain('│   cfg');
      const both = text(['graph', '--with', 'cf', '--with', 'df']).out;
      expect(both).toContain('│   cfg');
      expect(both).toContain('│   dfg');
      const docs = text(['graph', '--with', 'docs']).out;
      expect(docs).toContain('│   cfg');
      expect(docs).toContain('│   dfg');
    });
  });

  describe('json', () => {
    it('plain map: tag nodes carry no flow fields', () => {
      const { g, tag } = json(['map']);
      expect(g).toBeDefined();
      expect('cfg' in tag('sum')).toBe(false);
      expect('dfg' in tag('sum')).toBe(false);
    });

    it('map --with cf / df: only the asked field, optional on the tag', () => {
      const cf = json(['map', '--with', 'cf']).tag('sum');
      expect(cf.cfg.nodes[0]).toEqual({ id: 'n0', kind: 'entry', label: 'entry', line: 0 });
      expect('dfg' in cf).toBe(false);
      const df = json(['map', '--with', 'df']).tag('sum');
      expect(df.dfg.nodes.map((d: any) => `${d.name}:${d.kind}`)).toEqual([
        'xs:param', 'limit:param', 'total:decl', 'x:loop', 'total:update',
      ]);
      expect('cfg' in df).toBe(false);
    });

    it('graph: both fields; classes and non-functions carry none', () => {
      const { tag } = json(['graph']);
      expect(tag('sum').cfg.edges).toContainEqual({ from: 'n4', to: 'n5', label: 'true' });
      expect(tag('sum').dfg.edges).toContainEqual({ from: 'd2', to: 'n6' });
      expect(tag('Acc').cfg).toBeUndefined();
      expect(tag('add')?.cfg).toBeDefined();
    });
  });

  describe('other formats', () => {
    it('xml carries the flow', () => {
      const out = path.join(proj, 'g.xml');
      const r = run(['graph', '--format', 'xml', '-o', out]);
      expect(r.status).toBe(0);
      const xml = fs.readFileSync(out, 'utf8');
      expect(xml).toContain('<cfg>');
      expect(xml).toContain('<def id="d0" name="xs" kind="param"');
    });

    it('csv has no form for flow: usage error, nothing written, also for graph and for --dry-run', () => {
      for (const args of [['map', '--with', 'cf'], ['map', '--with', 'df'], ['graph'], ['graph', '--dry-run']]) {
        const out = path.join(proj, 'g.csv');
        fs.rmSync(out, { force: true });
        fs.rmSync(path.join(proj, 'g.nodes.csv'), { force: true });
        const r = run([...args, '--format', 'csv', '-o', out]);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('no csv form');
        expect(r.stderr).toContain('xray map --format csv');
        expect(r.stderr).toContain('without --with cf/df');
        expect(fs.existsSync(path.join(proj, 'g.nodes.csv'))).toBe(false);
      }
    });

    it('csv without flow still works', () => {
      const out = path.join(proj, 'ok.csv');
      expect(run(['map', '--format', 'csv', '-o', out]).status).toBe(0);
      expect(fs.existsSync(path.join(proj, 'ok.nodes.csv'))).toBe(true);
    });

    it('graph --dry-run lists the planned writes and writes none', () => {
      const out = path.join(proj, 'dry.json');
      const r = run(['graph', '--dry-run', '--format', 'json', '-o', out]);
      expect(r.status).toBe(0);
      expect(fs.existsSync(out)).toBe(false);
    });
  });

  describe('languages without flow support', () => {
    it('one stderr notice, run succeeds, no graph emitted for them', () => {
      const { r, g } = json(['graph']);
      expect(r.status).toBe(0);
      const notices = r.stderr.split('\n').filter(l => l.includes('no flow graphs'));
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('rust (1 file)');
      expect(notices[0]).toContain('Supported: typescript, javascript, python');
      const rs = g.nodes.find((n: any) => n.id === 'b.rs::rs_fn');
      expect(rs).toBeDefined();
      expect('cfg' in rs).toBe(false);
      expect('dfg' in rs).toBe(false);
    });

    it('stays quiet when flow is off, and on a warm cache it still notices', () => {
      expect(run(['map', '--format', 'json', '-o', path.join(proj, 'q.json')]).stderr).not.toContain('no flow graphs');
      json(['graph']);
      expect(json(['graph']).r.stderr).toContain('no flow graphs');
    });
  });

  describe('pathological functions', () => {
    it('a function too large to read is skipped with one stderr line; the run and its neighbours are fine', () => {
      const big = path.join(proj, 'big.ts');
      fs.writeFileSync(big, `export function huge(a: number) {\n${'  a = a + 1;\n'.repeat(30000)}  return a;\n}\nexport function small(b: number) { return b; }\n`);
      try {
        const { r, g } = json(['graph']);
        expect(r.status).toBe(0);
        expect(r.stderr).toContain('cf/df: skipped 1 function (source too large for flow)');
        const huge = g.nodes.find((n: any) => n.id === 'big.ts::huge');
        const small = g.nodes.find((n: any) => n.id === 'big.ts::small');
        expect(huge.cfg).toBeUndefined();
        expect(small.cfg).toBeDefined();
      } finally {
        fs.rmSync(big, { force: true });
      }
    });
  });

  describe('cache across flag sets', () => {
    it('map -> map --with cf -> map -> graph -> map --with df, cold and warm, each correct', () => {
      const has = (t: any) => [t.cfg !== undefined, t.dfg !== undefined];
      const seq: Array<[string[], boolean[]]> = [
        [['map'], [false, false]],
        [['map', '--with', 'cf'], [true, false]],
        [['map'], [false, false]],
        [['graph'], [true, true]],
        [['map', '--with', 'df'], [false, true]],
        [['map', '--with', 'cf'], [true, false]],
        [['graph'], [true, true]],
        [['map'], [false, false]],
      ];
      let full: any;
      for (const [args, want] of seq) {
        const { r, tag } = json(args);
        expect(r.status).toBe(0);
        expect(has(tag('sum'))).toEqual(want);
        if (args[0] === 'graph') {
          if (full) expect(tag('sum')).toEqual(full);
          full = tag('sum');
        }
      }
    });

    it('multi-root json: every root keeps its flow through the merge', () => {
      const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-cli-root2-'));
      fs.writeFileSync(path.join(root2, 'c.ts'), 'export function c(a: number) { return a; }\n');
      try {
        const out = path.join(proj, 'm.json');
        expect(run(['graph', '--path', proj, '--path', root2, '--format', 'json', '-o', out]).status).toBe(0);
        const g = JSON.parse(fs.readFileSync(out, 'utf8'));
        const withFlow = g.nodes.filter((n: any) => n.cfg && n.dfg).map((n: any) => n.label).sort();
        expect(withFlow).toEqual(['add', 'c', 'sum']);
      } finally {
        fs.rmSync(root2, { recursive: true, force: true });
      }
    });
  });

  describe('saved graphs', () => {
    it('query --graph and impact-style reads work with and without flow fields', () => {
      const withFlow = path.join(proj, 'flow.json');
      const plain = path.join(proj, 'plain.json');
      expect(run(['graph', '--format', 'json', '-o', withFlow]).status).toBe(0);
      expect(run(['map', '--format', 'json', '-o', plain]).status).toBe(0);
      for (const f of [withFlow, plain]) {
        const r = run(['query', 'calls(sum)', '--graph', f]);
        expect(r.status).toBe(0);
      }
      expect(JSON.parse(fs.readFileSync(withFlow, 'utf8')).nodes.some((n: any) => n.cfg)).toBe(true);
    });
  });

  describe('describe', () => {
    it('documents graph defaults and the language limit', () => {
      const r = run(['describe']);
      expect(r.status).toBe(0);
      const doc = JSON.parse(r.stdout);
      const cmds: any[] = doc.commands ?? doc.tools ?? [];
      const graph = cmds.find((c: any) => c.name === 'graph' || c.path?.join(' ') === 'graph');
      expect(JSON.stringify(graph)).toContain('cf and df are on unless one is named');
      expect(JSON.stringify(graph)).toContain('TypeScript, JavaScript, Python, Go');
    });
  });
});
