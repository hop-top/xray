/**
 * The cache db is shared by every root scanned from one cwd. Two roots holding
 * the same root-relative path with the same mtime (coarse-timestamp
 * filesystems, extracted archives, fast test writes) must not serve each
 * other's cached tags.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Xray } from '../../src/lib/xray';

describe('cache key is per file, not per root-relative path', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-cache-key-'));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('same relative path + equal mtime in two roots keeps each root\'s own symbols', async () => {
    const a = path.join(tmp, 'alpha');
    const b = path.join(tmp, 'beta');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, 'main.ts'), 'export function onlyInAlpha() {}\n');
    fs.writeFileSync(path.join(b, 'main.ts'), 'export function onlyInBeta() {}\n');
    const when = new Date('2024-01-01T00:00:00.000Z');
    fs.utimesSync(path.join(a, 'main.ts'), when, when);
    fs.utimesSync(path.join(b, 'main.ts'), when, when);

    const cachePath = path.join(tmp, 'shared.db');
    const names = async (root: string) => {
      const { graph } = await new Xray({ path: root, cachePath }).buildGraph();
      return graph.nodes().join(' ');
    };
    expect(await names(a)).toContain('onlyInAlpha');
    const second = await names(b);
    expect(second).toContain('onlyInBeta');
    expect(second).not.toContain('onlyInAlpha');
  });
});
