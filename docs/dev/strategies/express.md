# Express Strategy

Deep analysis strategy for Express.js applications with comprehensive route, router, middleware, and error handler detection.

## Detection

The Express strategy automatically detects projects using:

### Package Dependency
- `express` in `package.json` dependencies

### Code Patterns
- `express()` instantiation
- `app.listen()` calls
- Express imports: `require('express')` or `from 'express'`

## Analysis Features

### Route Detection
Detects HTTP route definitions across your Express application:

```javascript
// Detected patterns
app.get('/users', handler);
app.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
```

**Detected information:**
- HTTP method (GET, POST, PUT, DELETE, PATCH, etc.)
- Route path
- Handler function name (when using named functions)
- Middleware chain (when using multiple handlers)

### Middleware Chain Detection
Captures middleware applied to specific routes:

```javascript
// Detected: authenticate and authorize are middleware
router.get('/protected', authenticate, authorize('admin'), handler);
```

**Tags:** `express:route`

### Router Detection
Identifies Express Router instances and their mounting points:

```javascript
// Router instance
const router = express.Router();

// Router mounting
app.use('/api/users', userRouter);
app.use('/api/items', itemRouter);
```

**Tags:** `express:router`, `express:router-mount`

### Middleware Detection
Detects global and path-specific middleware:

```javascript
// Global middleware
app.use(express.json());
app.use(cors());

// Path-specific middleware
app.use('/public', express.static('public'));
```

**Tags:** `express:middleware`

### Error Handler Detection
Identifies 4-parameter error handling middleware:

```javascript
// Inline error handler
app.use((err, req, res, next) => {
  res.status(500).send('Something broke!');
});

// Named error handler
function errorHandler(err, req, res, next) {
  res.status(500).json({ error: err.message });
}
app.use(errorHandler);
```

**Tags:** `express:error-handler`

## Commands

### `express routes`

Lists all Express routes detected in the project.

```bash
xray express routes
```

**Output:**
```json
[
  {
    "method": "GET",
    "path": "/api/users",
    "file": "src/routes/users.ts",
    "handler": "getUsers"
  },
  {
    "method": "POST",
    "path": "/api/users",
    "file": "src/routes/users.ts",
    "handler": "createUser",
    "middleware": ["authenticate", "validateUser"]
  },
  {
    "method": "GET",
    "path": "/protected",
    "file": "src/routes/auth.ts",
    "middleware": ["authenticate", "authorize"]
  }
]
```

### `express routers`

Lists all Express Router instances and their mount points.

```bash
xray express routers
```

**Output:**
```json
[
  {
    "variable": "router",
    "file": "src/routes/users.ts"
  },
  {
    "path": "/api/users",
    "router": "userRouter",
    "file": "src/app.ts",
    "type": "mount"
  },
  {
    "path": "/api/items",
    "router": "itemRouter",
    "file": "src/app.ts",
    "type": "mount"
  }
]
```

### `express middleware`

Lists all middleware registered in the application.

```bash
xray express middleware
```

**Output:**
```json
[
  {
    "name": "express.json()",
    "file": "src/app.ts"
  },
  {
    "name": "cors()",
    "file": "src/app.ts"
  },
  {
    "name": "express.static('public')",
    "path": "/public",
    "file": "src/app.ts"
  }
]
```

### `express error-handlers`

Lists all error handling middleware.

```bash
xray express error-handlers
```

**Output:**
```json
[
  {
    "type": "inline",
    "file": "src/app.ts"
  },
  {
    "name": "errorHandler",
    "type": "named",
    "file": "src/middleware/errors.ts"
  }
]
```

## Tagging

Files are automatically tagged based on detected Express patterns:

- `express:route` - Files containing route definitions
- `express:router` - Files with Router instances
- `express:router-mount` - Files that mount routers
- `express:middleware` - Files with middleware definitions
- `express:error-handler` - Files with error handling middleware

## Use Cases

### API Surface Analysis
Quickly understand all HTTP endpoints in your Express application:

```bash
xray express routes | jq 'group_by(.method) | map({method: .[0].method, count: length})'
```

### Middleware Audit
Review all middleware applied across your application:

```bash
xray express middleware | jq '.[] | .name'
```

### Route Protection Analysis
Find routes with authentication/authorization middleware:

```bash
xray express routes | jq '.[] | select(.middleware | contains(["authenticate"]))'
```

### Router Architecture Review
Understand how your application is organized with routers:

```bash
xray express routers | jq 'group_by(.type)'
```

### Error Handling Coverage
Verify error handlers are properly implemented:

```bash
xray express error-handlers | jq 'length'
```

## Implementation Details

### Detection Method
Uses regex-based pattern matching for fast, reliable detection across JavaScript and TypeScript files.

### Middleware Chain Parsing
Advanced parenthesis depth tracking correctly handles complex middleware chains including function calls with arguments (e.g., `authorize('admin')`).

### File Types
Analyzes: `.js`, `.ts`, `.jsx`, `.tsx`

### Ignore Patterns
Skips:
- `node_modules/`
- Test files (`*.test.js`, `*.spec.ts`)
- Build output (`dist/`, `build/`)

## Comparison with REST API Strategy

The Express strategy provides deeper Express-specific analysis compared to the REST API strategy:

| Feature | REST API Strategy | Express Strategy |
|---------|-------------------|------------------|
| Framework Support | Multi-framework | Express only |
| Route Detection | ✅ Basic | ✅ Advanced |
| Middleware Chains | ❌ | ✅ |
| Router Detection | ❌ | ✅ |
| Error Handlers | ❌ | ✅ |
| Granularity | High-level overview | Deep analysis |

**When to use:**
- **REST API Strategy**: Cross-framework API surface overview
- **Express Strategy**: Deep Express-specific application analysis

## Version

**v0.0.1-alpha.1** - Initial implementation
- Route detection (GET, POST, PUT, DELETE, PATCH, etc.)
- Router instance and mounting detection
- Middleware detection (global and path-specific)
- Error handler detection (4-parameter functions)
- Middleware chain parsing with parenthesis depth tracking
- Express-specific deep analysis

## Future Enhancements

- Request/response schema extraction
- Middleware execution order analysis
- Route parameter validation detection
- Authentication/authorization pattern detection
- Performance middleware detection (compression, caching)
- CORS configuration analysis
- Rate limiting detection
