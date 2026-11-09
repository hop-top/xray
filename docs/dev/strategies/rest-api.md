# REST API Strategy

Cross-language REST API detection strategy for identifying HTTP endpoints, methods, and routing patterns across Express.js, FastAPI, Django, Flask, and Go HTTP frameworks.

## Detection

The REST API strategy automatically detects projects using:

### Node.js/JavaScript/TypeScript
- **Express.js**: `express` dependency
- **Fastify**: `fastify` dependency
- **Koa**: `koa` dependency

### Python
- **FastAPI**: `from fastapi import` or `import fastapi`
- **Flask**: `from flask import` or `import flask`
- **Django**: `from django.` or `import django`

### Go
- **net/http**: `import "net/http"`
- **Gorilla Mux**: `import "github.com/gorilla/mux"`
- **Gin**: `import "github.com/gin-gonic/gin"`
- **Echo**: `import "github.com/labstack/echo"`

## Route Detection

The strategy detects REST API endpoints across all supported frameworks:

### Express.js Routes
```javascript
// Detected patterns
app.get('/users', handler);
app.post('/users', handler);
router.put('/users/:id', handler);
router.delete('/users/:id', handler);
```

### FastAPI Routes
```python
# Detected patterns
@app.get("/users")
def read_users(): pass

@router.post("/items")
def create_item(): pass
```

### Go HTTP Handlers
```go
// Detected patterns
http.HandleFunc("/users", usersHandler)

r.HandleFunc("/api/items", getItems).Methods("GET")

mux.Handle("GET /api/users", http.HandlerFunc(getUsers))
```

## HTTP Method Normalization

All HTTP methods are normalized to uppercase across frameworks:
- `app.get()` → `GET`
- `@app.post()` → `POST`
- `.Methods("PUT")` → `PUT`

This provides a consistent view of your API surface regardless of the underlying framework.

## Commands

### `rest-api endpoints`

Lists all REST API endpoints detected in the project.

```bash
xray rest-api endpoints
```

**Output:**
```json
[
  {
    "method": "GET",
    "path": "/api/users",
    "file": "src/routes/users.ts",
    "framework": "Express/Node.js"
  },
  {
    "method": "POST",
    "path": "/api/users",
    "file": "src/routes/users.ts",
    "framework": "Express/Node.js"
  },
  {
    "method": "GET",
    "path": "/api/items/{id}",
    "file": "main.py",
    "framework": "FastAPI/Flask/Django"
  }
]
```

### `rest-api methods`

Groups endpoints by HTTP method.

```bash
xray rest-api methods
```

**Output:**
```json
{
  "GET": [
    { "path": "/api/users", "file": "src/routes/users.ts" },
    { "path": "/api/items/{id}", "file": "main.py" }
  ],
  "POST": [
    { "path": "/api/users", "file": "src/routes/users.ts" }
  ],
  "PUT": [
    { "path": "/api/items/{id}", "file": "handlers.go" }
  ]
}
```

### `rest-api middleware`

Lists middleware and interceptors (when detected).

```bash
xray rest-api middleware
```

## Tagging

Files with REST API endpoints are tagged with:
- `rest-api:endpoint` - Files containing HTTP route definitions

## Use Cases

### API Surface Analysis
Quickly understand all HTTP endpoints across your entire codebase, regardless of language or framework:

```bash
xray rest-api endpoints | jq 'group_by(.method) | map({method: .[0].method, count: length})'
```

### Cross-Framework API Inventory
When migrating between frameworks or working in polyglot codebases, get a unified view of all REST endpoints:

```bash
xray rest-api endpoints | jq 'group_by(.framework)'
```

### API Documentation Preparation
Extract all endpoints as a foundation for API documentation:

```bash
xray rest-api methods > api-inventory.json
```

## Framework Coverage

Current implementation status for each framework:

| Framework | Detection | Route Extraction | Method Normalization | Status |
|-----------|-----------|------------------|---------------------|---------|
| Express.js | ✅ | ✅ | ✅ | **Fully Supported** |
| FastAPI | ✅ | ✅ | ✅ | **Fully Supported** |
| Go net/http | ✅ | ✅ | ✅ | **Fully Supported** |
| Gorilla Mux | ✅ | ✅ | ✅ | **Fully Supported** |
| Fastify | ✅ | ⏳ | ⏳ | Detection Only |
| Koa | ✅ | ⏳ | ⏳ | Detection Only |
| Flask | ✅ | ⏳ | ⏳ | Detection Only |
| Django | ✅ | ⏳ | ⏳ | Detection Only |
| Gin | ✅ | ⏳ | ⏳ | Detection Only |
| Echo | ✅ | ⏳ | ⏳ | Detection Only |

**Legend:**
- ✅ = Fully Implemented
- ⏳ = Planned Enhancement

**Note:** Frameworks marked "Detection Only" will detect the framework but won't extract detailed route information yet. These are planned enhancements for future versions.

## Version

**v0.0.1-alpha.1** - Initial implementation
- Express.js route detection
- FastAPI route detection
- Go net/http and Gorilla Mux handler detection
- HTTP method normalization across frameworks
- Cross-language endpoint inventory

## Future Enhancements

- Request/response schema detection
- Middleware chain analysis
- Authentication/authorization detection
- Rate limiting detection
- OpenAPI/Swagger generation
- Framework-specific patterns (Fastify, Koa, Flask, Django, Gin, Echo)
