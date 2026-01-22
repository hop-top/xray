// tests/strategy/context.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import * as fs from 'fs';
import * as path from 'path';

describe('StrategyContext', () => {
  let ctx: StrategyContextImpl;
  const testRoot = path.join(__dirname, 'fixtures/test-project');

  beforeEach(() => {
    ctx = new StrategyContextImpl(testRoot);
  });

  it('should detect dependencies from package.json', () => {
    expect(ctx.hasDependency('react')).toBe(true);
    expect(ctx.hasDependency('nonexistent')).toBe(false);
  });

  it('should detect files by pattern', () => {
    expect(ctx.hasFiles('*.tsx')).toBe(true);
    expect(ctx.hasFiles('*.xyz')).toBe(false);
  });

  it('should read files', async () => {
    const content = await ctx.readFile('package.json');
    expect(content).toContain('"name"');
  });
});
