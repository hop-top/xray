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

  it('should expose extension-scoped config values', () => {
    const glossaryConfig = {
      enabled: true,
      threshold: 0.7,
      hints: ['terms', 'definitions'],
      enabledSurfaces: {
        detect: true,
        export: false,
      },
    };

    ctx = new StrategyContextImpl(testRoot, {
      extensions: {
        glossary: glossaryConfig,
      },
    });

    expect(ctx.getExtensionConfig('glossary')).toEqual(glossaryConfig);
    expect(ctx.getConfig('glossary.threshold')).toBe(0.7);
    expect(ctx.getConfig('glossary.enabledSurfaces.detect')).toBe(true);
    expect(ctx.getExtensionConfig('missing')).toBeUndefined();
  });

  it('should cache file lists for repeated glob patterns', () => {
    // First call should populate cache
    const files1 = ctx.globFiles('**/*');

    // Second call with same pattern should use cache
    const files2 = ctx.globFiles('**/*');

    // Results should be identical
    expect(files1).toEqual(files2);
    expect(files1.length).toBeGreaterThan(0);
  });

  it('should use targeted glob patterns in findFiles', async () => {
    // Query with extension should use targeted pattern
    const tsxFiles = await ctx.findFiles({ extension: '.tsx' });

    expect(tsxFiles.length).toBeGreaterThan(0);
    expect(tsxFiles.every(f => f.endsWith('.tsx'))).toBe(true);
  });

  it('should handle findFiles performance efficiently', async () => {
    const start = performance.now();

    // Run multiple queries
    await ctx.findFiles({ extension: '.tsx' });
    await ctx.findFiles({ extension: '.ts' });
    await ctx.findFiles({ pattern: 'test' });

    const duration = performance.now() - start;

    // Should complete quickly (< 100ms for small test project)
    expect(duration).toBeLessThan(100);
  });
});
