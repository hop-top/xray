// tests/strategies/rest-api.test.ts
import { StrategyContextImpl } from '../../src/lib/strategy/context';
import RestApiStrategy from '../../strategies/rest-api';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('RestApiStrategy', () => {
  let strategy: RestApiStrategy;

  beforeEach(() => {
    strategy = new RestApiStrategy();
  });

  describe('metadata', () => {
    it('should have correct name and version', () => {
      expect(strategy.name).toBe('rest-api');
      expect(strategy.version).toBe('0.1.0');
    });
  });

  describe('detection', () => {
    it('should detect Express.js projects', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-'));

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

    it('should detect FastAPI projects with FastAPI import', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-fastapi-'));

      const mainPy = `from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"Hello": "World"}`;

      fs.writeFileSync(path.join(tempDir, 'main.py'), mainPy);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect Go HTTP projects with net/http', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-go-http-'));

      const mainGo = `package main

import "net/http"

func handler(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("Hello World"))
}

func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}`;

      fs.writeFileSync(path.join(tempDir, 'main.go'), mainGo);

      const ctx = new StrategyContextImpl(tempDir);
      const detected = await strategy.detect(ctx);

      expect(detected).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should not detect non-REST projects', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-no-rest-'));

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
      expect(types).toContain('.py');
      expect(types).toContain('.go');
    });
  });

  describe('ignorePatterns', () => {
    it('should return ignore patterns', () => {
      const patterns = strategy.ignorePatterns();
      expect(patterns).toContain('**/node_modules/**');
      expect(patterns).toContain('**/__pycache__/**');
      expect(patterns).toContain('**/vendor/**');
    });
  });

  describe('Express route detection', () => {
    it('should detect app.get() routes', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-get-'));

      const routesJs = `const express = require('express');
const app = express();

app.get('/users', (req, res) => {
  res.json({ users: [] });
});

app.get('/users/:id', (req, res) => {
  res.json({ user: { id: req.params.id } });
});`;

      fs.writeFileSync(path.join(tempDir, 'routes.js'), routesJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'routes.js'), ctx);

      expect(metadata.tags).toContain('rest-api:endpoint');
      expect(metadata.metadata?.endpoints).toBeDefined();
      expect(metadata.metadata?.endpoints?.length).toBe(2);
      expect(metadata.metadata?.endpoints[0]).toMatchObject({
        method: 'GET',
        path: '/users'
      });
      expect(metadata.metadata?.endpoints[1]).toMatchObject({
        method: 'GET',
        path: '/users/:id'
      });

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect router.post() routes', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-post-'));

      const routesJs = `const express = require('express');
const router = express.Router();

router.post('/users', (req, res) => {
  res.json({ created: true });
});`;

      fs.writeFileSync(path.join(tempDir, 'routes.js'), routesJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'routes.js'), ctx);

      expect(metadata.tags).toContain('rest-api:endpoint');
      expect(metadata.metadata?.endpoints).toBeDefined();
      expect(metadata.metadata?.endpoints[0]).toMatchObject({
        method: 'POST',
        path: '/users'
      });

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect multiple HTTP methods', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-express-methods-'));

      const routesTs = `import express from 'express';
const router = express.Router();

router.get('/items', (req, res) => res.json([]));
router.post('/items', (req, res) => res.json({ created: true }));
router.put('/items/:id', (req, res) => res.json({ updated: true }));
router.delete('/items/:id', (req, res) => res.json({ deleted: true }));
router.patch('/items/:id', (req, res) => res.json({ patched: true }));`;

      fs.writeFileSync(path.join(tempDir, 'routes.ts'), routesTs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'routes.ts'), ctx);

      expect(metadata.tags).toContain('rest-api:endpoint');
      expect(metadata.metadata?.endpoints?.length).toBe(5);

      const methods = metadata.metadata?.endpoints.map((e: any) => e.method);
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
      expect(methods).toContain('PUT');
      expect(methods).toContain('DELETE');
      expect(methods).toContain('PATCH');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('FastAPI route detection', () => {
    it('should detect @app.get() decorator routes', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-fastapi-get-'));

      const mainPy = `from fastapi import FastAPI

app = FastAPI()

@app.get("/users")
def read_users():
    return {"users": []}

@app.get("/users/{user_id}")
def read_user(user_id: int):
    return {"user_id": user_id}`;

      fs.writeFileSync(path.join(tempDir, 'main.py'), mainPy);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'main.py'), ctx);

      expect(metadata.tags).toContain('rest-api:endpoint');
      expect(metadata.metadata?.endpoints).toBeDefined();
      expect(metadata.metadata?.endpoints?.length).toBe(2);
      expect(metadata.metadata?.endpoints[0]).toMatchObject({
        method: 'GET',
        path: '/users'
      });
      expect(metadata.metadata?.endpoints[1]).toMatchObject({
        method: 'GET',
        path: '/users/{user_id}'
      });

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect @router.post() decorator routes', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-fastapi-post-'));

      const routesPy = `from fastapi import APIRouter

router = APIRouter()

@router.post("/items")
def create_item(item: dict):
    return {"created": True}`;

      fs.writeFileSync(path.join(tempDir, 'routes.py'), routesPy);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'routes.py'), ctx);

      expect(metadata.tags).toContain('rest-api:endpoint');
      expect(metadata.metadata?.endpoints).toBeDefined();
      expect(metadata.metadata?.endpoints[0]).toMatchObject({
        method: 'POST',
        path: '/items'
      });

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect multiple FastAPI HTTP methods', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-fastapi-methods-'));

      const apiPy = `from fastapi import FastAPI

app = FastAPI()

@app.get("/items")
def list_items():
    return []

@app.post("/items")
def create_item():
    return {"created": True}

@app.put("/items/{id}")
def update_item(id: int):
    return {"updated": True}

@app.delete("/items/{id}")
def delete_item(id: int):
    return {"deleted": True}

@app.patch("/items/{id}")
def patch_item(id: int):
    return {"patched": True}`;

      fs.writeFileSync(path.join(tempDir, 'api.py'), apiPy);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'api.py'), ctx);

      expect(metadata.tags).toContain('rest-api:endpoint');
      expect(metadata.metadata?.endpoints?.length).toBe(5);

      const methods = metadata.metadata?.endpoints.map((e: any) => e.method);
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
      expect(methods).toContain('PUT');
      expect(methods).toContain('DELETE');
      expect(methods).toContain('PATCH');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('Go HTTP handler detection', () => {
    it('should detect http.HandleFunc() routes', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-go-handlefunc-'));

      const mainGo = `package main

import "net/http"

func main() {
    http.HandleFunc("/users", usersHandler)
    http.HandleFunc("/users/", userHandler)
    http.ListenAndServe(":8080", nil)
}

func usersHandler(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("users"))
}`;

      fs.writeFileSync(path.join(tempDir, 'main.go'), mainGo);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'main.go'), ctx);

      expect(metadata.tags).toContain('rest-api:endpoint');
      expect(metadata.metadata?.endpoints).toBeDefined();
      expect(metadata.metadata?.endpoints?.length).toBe(2);
      expect(metadata.metadata?.endpoints[0]).toMatchObject({
        path: '/users'
      });
      expect(metadata.metadata?.endpoints[1]).toMatchObject({
        path: '/users/'
      });

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect mux.HandleFunc() routes', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-go-mux-'));

      const mainGo = `package main

import (
    "net/http"
    "github.com/gorilla/mux"
)

func main() {
    r := mux.NewRouter()
    r.HandleFunc("/api/items", getItems).Methods("GET")
    r.HandleFunc("/api/items/{id}", getItem).Methods("GET")
    r.HandleFunc("/api/items", createItem).Methods("POST")
    http.ListenAndServe(":8080", r)
}`;

      fs.writeFileSync(path.join(tempDir, 'main.go'), mainGo);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'main.go'), ctx);

      expect(metadata.tags).toContain('rest-api:endpoint');
      expect(metadata.metadata?.endpoints?.length).toBe(3);

      const getEndpoints = metadata.metadata?.endpoints.filter((e: any) => e.method === 'GET');
      const postEndpoints = metadata.metadata?.endpoints.filter((e: any) => e.method === 'POST');

      expect(getEndpoints.length).toBe(2);
      expect(postEndpoints.length).toBe(1);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should detect http.Handle() with http.MethodGet patterns', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-go-handle-'));

      const mainGo = `package main

import "net/http"

func main() {
    mux := http.NewServeMux()
    mux.Handle("GET /api/users", http.HandlerFunc(getUsers))
    mux.Handle("POST /api/users", http.HandlerFunc(createUser))
    mux.Handle("DELETE /api/users/{id}", http.HandlerFunc(deleteUser))
    http.ListenAndServe(":8080", mux)
}`;

      fs.writeFileSync(path.join(tempDir, 'main.go'), mainGo);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'main.go'), ctx);

      expect(metadata.tags).toContain('rest-api:endpoint');
      expect(metadata.metadata?.endpoints?.length).toBe(3);

      const methods = metadata.metadata?.endpoints.map((e: any) => e.method);
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
      expect(methods).toContain('DELETE');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('HTTP method normalization', () => {
    it('should normalize Express methods to uppercase', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-normalize-express-'));

      const routesJs = `
app.get('/users', handler);
app.post('/users', handler);
app.put('/users/:id', handler);
app.delete('/users/:id', handler);
app.patch('/users/:id', handler);
`;

      fs.writeFileSync(path.join(tempDir, 'routes.js'), routesJs);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'routes.js'), ctx);

      const methods = metadata.metadata?.endpoints.map((e: any) => e.method);
      expect(methods).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should normalize FastAPI methods to uppercase', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-normalize-fastapi-'));

      const mainPy = `
@app.get("/items")
def list_items(): pass

@app.post("/items")
def create_item(): pass

@router.put("/items/{id}")
def update_item(): pass
`;

      fs.writeFileSync(path.join(tempDir, 'main.py'), mainPy);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'main.py'), ctx);

      const methods = metadata.metadata?.endpoints.map((e: any) => e.method);
      expect(methods).toEqual(['GET', 'POST', 'PUT']);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should normalize Go methods to uppercase', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-normalize-go-'));

      const mainGo = `
r.HandleFunc("/items", getItems).Methods("GET")
r.HandleFunc("/items", createItem).Methods("POST")
mux.Handle("DELETE /items/{id}", deleteHandler)
`;

      fs.writeFileSync(path.join(tempDir, 'main.go'), mainGo);

      const ctx = new StrategyContextImpl(tempDir);
      const metadata = await strategy.analyze(path.join(tempDir, 'main.go'), ctx);

      const methods = metadata.metadata?.endpoints.map((e: any) => e.method);
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
      expect(methods).toContain('DELETE');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should produce consistent method names across all frameworks', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cross-framework-'));

      // Create Express file
      const expressFile = `app.get('/api/users', handler);`;
      fs.writeFileSync(path.join(tempDir, 'express.js'), expressFile);

      // Create FastAPI file
      const fastapiFile = `@app.get("/api/users")`;
      fs.writeFileSync(path.join(tempDir, 'fastapi.py'), fastapiFile);

      // Create Go file
      const goFile = `r.HandleFunc("/api/users", handler).Methods("GET")`;
      fs.writeFileSync(path.join(tempDir, 'handlers.go'), goFile);

      const ctx = new StrategyContextImpl(tempDir);

      const expressMetadata = await strategy.analyze(path.join(tempDir, 'express.js'), ctx);
      const fastapiMetadata = await strategy.analyze(path.join(tempDir, 'fastapi.py'), ctx);
      const goMetadata = await strategy.analyze(path.join(tempDir, 'handlers.go'), ctx);

      expect(expressMetadata.metadata?.endpoints[0].method).toBe('GET');
      expect(fastapiMetadata.metadata?.endpoints[0].method).toBe('GET');
      expect(goMetadata.metadata?.endpoints[0].method).toBe('GET');

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
