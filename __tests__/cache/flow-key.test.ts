import { SqliteCache } from '../../src/lib/cache/sqlite-cache';
import { flowCacheKey, flowLanguages } from '../../src/lib/flow';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

/** Per-file entries are valid only for the flow selection they were parsed with. */
describe('per-file cache: flow selection', () => {
  let db: string;
  let cache: SqliteCache;
  const tag = (extra: object = {}) => ({ file: 'a.ts', name: 'f', kind: 'function', line: 0, col: 0, ...extra }) as any;

  beforeEach(() => {
    db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flow-key-')), 'c.db');
    cache = new SqliteCache(db);
  });
  afterEach(() => {
    cache.close();
    fs.rmSync(path.dirname(db), { recursive: true, force: true });
  });

  const CF = flowCacheKey(true, false);
  const DF = flowCacheKey(false, true);
  const BOTH = flowCacheKey(true, true);

  it('keys differ per selection and are empty when flow is off', () => {
    expect(flowCacheKey(false, false)).toBe('');
    expect(new Set([CF, DF, BOTH]).size).toBe(3);
    expect(CF).toContain(flowLanguages().join('+'));
  });

  it('a flow-less entry does not serve a flow run, and the reverse', () => {
    cache.set('/a.ts', 1, [tag()], [], 'none', false);
    expect(cache.get('/a.ts', 1, 'none', false)).not.toBeNull();
    expect(cache.get('/a.ts', 1, 'none', false, CF)).toBeNull();

    cache.set('/a.ts', 1, [tag({ cfg: { nodes: [], edges: [] } })], [], 'none', false, undefined, CF);
    expect(cache.get('/a.ts', 1, 'none', false, CF)).not.toBeNull();
    expect(cache.get('/a.ts', 1, 'none', false, DF)).toBeNull();
    expect(cache.get('/a.ts', 1, 'none', false, BOTH)).toBeNull();
    expect(cache.get('/a.ts', 1, 'none', false)).toBeNull();
  });

  it('an entry written before the flow key existed (stub cfg, no key) never reaches a run', () => {
    cache.set('/a.ts', 1, [tag({ cfg: { nodes: [{ id: 'cfg_0' }], edges: [] } })], [], 'none', false);
    expect(cache.get('/a.ts', 1, 'none', false)).toBeNull();
    expect(cache.get('/a.ts', 1, 'none', false, CF)).toBeNull();
  });
});
