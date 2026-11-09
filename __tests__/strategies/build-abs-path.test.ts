import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import BuildStrategy from '../../strategies/build';
import { StrategyContextImpl } from '../../src/lib/strategy/context';

// The loader hands analyze() absolute paths; detection is root-relative.
describe('build analyze with absolute paths', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-build-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const run = async (name: string, body: string) => {
    fs.writeFileSync(path.join(root, name), body);
    const ctx = new StrategyContextImpl(root);
    return new BuildStrategy().analyze(path.join(root, name), ctx);
  };

  it('parses a Makefile', async () => {
    const r = await run('Makefile', 'all: build\nbuild:\n\techo b\n');
    expect(r.metadata.buildTool).toBe('make');
    expect(r.tags).toEqual(expect.arrayContaining(['build:all', 'build:build']));
  });

  it('parses package.json scripts', async () => {
    const r = await run('package.json', '{"scripts":{"build":"tsc","test":"jest"}}');
    expect(r.metadata.buildTool).toBe('npm');
    expect(r.tags).toEqual(expect.arrayContaining(['build:build', 'build:test']));
  });
});
