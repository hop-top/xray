// tests/strategies/express.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import ExpressStrategy from '../../strategies/express';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('ExpressStrategy', () => {
  let strategy: ExpressStrategy;

  beforeEach(() => {
    strategy = new ExpressStrategy();
  });

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(strategy.name).toBe('express');
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('detection', () => {
    it('should detect Express projects with express dependency', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-dep-'));

      const packageJson = `{
  "name": "test-app",
  "dependencies": {
    "express": "^4.18.0"
  }
}`;

      fs.writeFileSync(path.join(tempDir, 'package.json'), packageJson);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect Express with express() instantiation', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-inst-'));

      const appJs = `const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World');
});`;

      fs.writeFileSync(path.join(tempDir, 'app.js'), appJs);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect Express with app.listen()', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-listen-'));

      const serverTs = `import express from 'express';
const app = express();

app.listen(3000, () => {
  console.log('Server running');
});`;

      fs.writeFileSync(path.join(tempDir, 'server.ts'), serverTs);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not detect non-Express projects', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-no-express-'));

      const packageJson = `{
  "name": "test-app",
  "dependencies": {
    "lodash": "^4.17.21"
  }
}`;

      fs.writeFileSync(path.join(tempDir, 'package.json'), packageJson);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(false);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('fileTypes', () => {
    it('should return supported file types', () => {
      const types = strategy.fileTypes();
      expect(types).toContain('.js');
      expect(types).toContain('.ts');
    });
  });

  describe('ignorePatterns', () => {
    it('should return ignore patterns', () => {
      const patterns = strategy.ignorePatterns();
      expect(patterns).toContain('**/node_modules/**');
      expect(patterns).toContain('**/*.test.js');
      expect(patterns).toContain('**/*.spec.ts');
    });
  });

  describe('router detection', () => {
    it('should detect express.Router() instances', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-router-inst-'));

      const routerJs = `const express = require('express');
const router = express.Router();

router.get('/items', (req, res) => res.json([]));

module.exports = router;`;

      fs.mkdirSync(path.join(tempDir, 'routes'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'routes/items.js'), routerJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'routes/items.js'), ctx);

      expect(metadata.tags).toContain('express:router');
      expect(metadata.metadata?.routers).toBeDefined();
      expect(metadata.metadata?.routers?.length).toBe(1);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect app.use() router mounting', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-router-mount-'));

      const appJs = `const express = require('express');
const app = express();
const userRouter = require('./routes/users');
const itemRouter = require('./routes/items');

app.use('/api/users', userRouter);
app.use('/api/items', itemRouter);

module.exports = app;`;

      fs.writeFileSync(path.join(tempDir, 'app.js'), appJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'app.js'), ctx);

      expect(metadata.tags).toContain('express:router-mount');
      expect(metadata.metadata?.routerMounts).toBeDefined();
      expect(metadata.metadata?.routerMounts?.length).toBe(2);
      expect(metadata.metadata?.routerMounts[0]).toMatchObject({
        path: '/api/users',
        router: 'userRouter'
      });
      expect(metadata.metadata?.routerMounts[1]).toMatchObject({
        path: '/api/items',
        router: 'itemRouter'
      });

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('middleware detection', () => {
    it('should detect app.use() middleware', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-middleware-'));

      const appJs = `const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use('/public', express.static('public'));

module.exports = app;`;

      fs.writeFileSync(path.join(tempDir, 'app.js'), appJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'app.js'), ctx);

      expect(metadata.tags).toContain('express:middleware');
      expect(metadata.metadata?.middleware).toBeDefined();
      expect(metadata.metadata?.middleware?.length).toBeGreaterThan(0);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect middleware chains', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-chain-'));

      const routesJs = `const router = express.Router();

router.get('/protected', authenticate, authorize('admin'), (req, res) => {
  res.json({ data: 'secret' });
});

module.exports = router;`;

      fs.writeFileSync(path.join(tempDir, 'routes.js'), routesJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'routes.js'), ctx);

      expect(metadata.metadata?.routes).toBeDefined();
      const route = metadata.metadata?.routes[0];
      expect(route?.middlewareChain).toBeDefined();
      expect(route?.middlewareChain).toContain('authenticate');
      expect(route?.middlewareChain).toContain('authorize');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('error handler detection', () => {
    it('should detect error handling middleware', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-error-'));

      const appJs = `const express = require('express');
const app = express();

// 4-parameter error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

module.exports = app;`;

      fs.writeFileSync(path.join(tempDir, 'app.js'), appJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'app.js'), ctx);

      expect(metadata.tags).toContain('express:error-handler');
      expect(metadata.metadata?.errorHandlers).toBeDefined();
      expect(metadata.metadata?.errorHandlers?.length).toBe(1);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect named error handlers', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-named-error-'));

      const appJs = `const app = require('express')();

function errorHandler(err, req, res, next) {
  res.status(500).json({ error: err.message });
}

app.use(errorHandler);

module.exports = app;`;

      fs.writeFileSync(path.join(tempDir, 'app.js'), appJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'app.js'), ctx);

      expect(metadata.tags).toContain('express:error-handler');
      expect(metadata.metadata?.errorHandlers).toBeDefined();
      expect(metadata.metadata?.errorHandlers?.length).toBeGreaterThan(0);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('route detection', () => {
    it('should detect app.get() routes', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-routes-'));

      const routesJs = `const express = require('express');
const app = express();

app.get('/users', (req, res) => {
  res.json({ users: [] });
});

app.post('/users', (req, res) => {
  res.status(201).json({ created: true });
});`;

      fs.writeFileSync(path.join(tempDir, 'routes.js'), routesJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'routes.js'), ctx);

      expect(metadata.tags).toContain('express:route');
      expect(metadata.metadata?.routes).toBeDefined();
      expect(metadata.metadata?.routes?.length).toBe(2);
      expect(metadata.metadata?.routes[0]).toMatchObject({
        method: 'GET',
        path: '/users'
      });
      expect(metadata.metadata?.routes[1]).toMatchObject({
        method: 'POST',
        path: '/users'
      });

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect router.METHOD() routes', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-router-routes-'));

      const routerTs = `import express from 'express';
const router = express.Router();

router.get('/items', (req, res) => res.json([]));
router.put('/items/:id', (req, res) => res.json({ updated: true }));
router.delete('/items/:id', (req, res) => res.status(204).send());

export default router;`;

      fs.writeFileSync(path.join(tempDir, 'router.ts'), routerTs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'router.ts'), ctx);

      expect(metadata.tags).toContain('express:route');
      expect(metadata.metadata?.routes?.length).toBe(3);

      const methods = metadata.metadata?.routes.map((r: any) => r.method);
      expect(methods).toContain('GET');
      expect(methods).toContain('PUT');
      expect(methods).toContain('DELETE');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should extract route handlers', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-handlers-'));

      const appJs = `const app = require('express')();

app.get('/api/users', getUsersHandler);
app.post('/api/users', createUserHandler);`;

      fs.writeFileSync(path.join(tempDir, 'app.js'), appJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'app.js'), ctx);

      expect(metadata.metadata?.routes[0]).toMatchObject({
        method: 'GET',
        path: '/api/users',
        handler: 'getUsersHandler'
      });
      expect(metadata.metadata?.routes[1]).toMatchObject({
        method: 'POST',
        path: '/api/users',
        handler: 'createUserHandler'
      });

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
