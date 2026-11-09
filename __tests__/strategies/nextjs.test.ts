// tests/strategies/nextjs.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import NextjsStrategy from '../../strategies/nextjs';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('NextjsStrategy', () => {
  let strategy: NextjsStrategy;

  beforeEach(() => {
    strategy = new NextjsStrategy();
  });

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(strategy.name).toBe('nextjs');
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('detection', () => {
    it('should detect Next.js project with next dependency', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-nextjs-dep-'));

      const pkgJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          'next': '^14.0.0',
          'react': '^18.2.0'
        }
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(pkgJson, null, 2)
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect Next.js with next.config.js', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-nextjs-config-'));

      fs.writeFileSync(
        path.join(tempDir, 'next.config.js'),
        'module.exports = {}'
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect Next.js with app directory', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-nextjs-app-'));

      fs.mkdirSync(path.join(tempDir, 'app'));
      fs.writeFileSync(
        path.join(tempDir, 'app', 'page.tsx'),
        'export default function Page() { return <div>Home</div>; }'
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect Next.js with pages directory', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-nextjs-pages-'));

      fs.mkdirSync(path.join(tempDir, 'pages'));
      fs.writeFileSync(
        path.join(tempDir, 'pages', 'index.tsx'),
        'export default function Home() { return <div>Home</div>; }'
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not detect non-Next.js project', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-no-nextjs-'));

      const pkgJson = {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          'express': '^4.18.0'
        }
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(pkgJson, null, 2)
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(false);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect with next dev dependency', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-nextjs-dev-'));

      const pkgJson = {
        name: 'test-project',
        version: '1.0.0',
        devDependencies: {
          'next': '^14.0.0'
        }
      };

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(pkgJson, null, 2)
      );

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
