import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../src/lib/xray';
import { Confidence } from '../../src/types/graph';

/**
 * `imports` edges come from the contract records' `resolved.file` (any
 * language), resolved over the graph's file set plus the manifests under
 * the root.
 */
describe('imports edges from resolved contract records', () => {
  let root: string;

  const files: Record<string, string> = {
    // Python: relative import inside a package; a same-named decoy elsewhere.
    'app/__init__.py': '',
    'app/main.py': 'from .sub.util import helper\n\ndef run():\n    return helper()\n',
    'app/sub/__init__.py': '',
    'app/sub/util.py': 'def helper():\n    return 1\n',
    'other/util.py': 'def helper():\n    return 2\n',
    // PHP: bare include path (not `./`-relative).
    'web/index.php': '<?php\nrequire "lib/db.php";\n',
    'web/lib/db.php': '<?php\nfunction connect() {}\n',
    // Rust: `mod` declaration.
    'crate/Cargo.toml': '[package]\nname = "c"\n',
    'crate/src/main.rs': 'mod net;\nfn main() {}\n',
    'crate/src/net.rs': 'pub fn dial() {}\n',
    // TS: workspace package subpath (needs package.json, a manifest).
    'packages/lib/package.json': '{"name": "@me/lib"}\n',
    'packages/lib/util.ts': 'export function fmt() { return 1; }\n',
    'packages/app/main.ts': "import { fmt } from '@me/lib/util';\nexport function go() { return fmt(); }\n",
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-resolved-edges-'));
    for (const [rel, src] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), src);
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function graph() {
    const xray = new Xray({ path: root, cachePath: ':memory:', chunked: false });
    return (await xray.buildGraph()).graph;
  }

  function edges(g: Awaited<ReturnType<typeof graph>>, type: string) {
    const out: Array<{ source: string; target: string; confidence?: string }> = [];
    g.forEachEdge((_e: string, a: any, source: string, target: string) => {
      if (a.type === type) out.push({ source, target, confidence: a.confidence });
    });
    return out.sort((a, b) => (a.source + a.target).localeCompare(b.source + b.target));
  }

  it('links Python, PHP, Rust and TS workspace imports to the resolved files', async () => {
    expect(edges(await graph(), 'imports')).toEqual([
      { source: 'app/main.py', target: 'app/sub/util.py', confidence: Confidence.EXTRACTED },
      { source: 'crate/src/main.rs', target: 'crate/src/net.rs', confidence: Confidence.EXTRACTED },
      { source: 'packages/app/main.ts', target: 'packages/lib/util.ts', confidence: Confidence.EXTRACTED },
      { source: 'web/index.php', target: 'web/lib/db.php', confidence: Confidence.EXTRACTED },
    ]);
  });

  it('the import tier picks the imported file over a same-named decoy', async () => {
    const calls = edges(await graph(), 'calls').filter(e => e.source === 'app/main.py::run');
    expect(calls).toEqual([
      { source: 'app/main.py::run', target: 'app/sub/util.py::helper', confidence: Confidence.EXTRACTED },
    ]);
  });

  it('manifests are resolution inputs only, never file nodes', async () => {
    const g = await graph();
    expect(g.hasNode('crate/Cargo.toml')).toBe(false);
    expect(g.hasNode('packages/lib/package.json')).toBe(false);
  });
});
