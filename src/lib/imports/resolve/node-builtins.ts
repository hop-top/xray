/**
 * Node.js builtin module names: `require('module').builtinModules` of
 * Node 26.13.0 (vendored, so locality does not depend on the Node running
 * xray; regenerate with
 * `node -p "JSON.stringify(require('module').builtinModules)"`).
 * Includes the internal `_`-prefixed modules, as Node lists them.
 */

export const NODE_BUILTINS_VERSION = '26.13.0';

/** Importable bare or with `node:` (`fs`, `node:fs`). */
export const NODE_BUILTINS: ReadonlySet<string> = new Set([
  '_http_agent', '_http_client', '_http_common', '_http_incoming', '_http_outgoing', '_http_server',
  '_tls_common', '_tls_wrap', 'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process',
  'cluster', 'console', 'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'dns/promises',
  'domain', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'inspector/promises', 'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'readline/promises', 'repl', 'stream',
  'stream/consumers', 'stream/promises', 'stream/web', 'string_decoder', 'sys', 'timers',
  'timers/promises', 'tls', 'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
]);

/** Importable only with the prefix (`node:test`; bare `test` is a package), stored without it. */
export const NODE_PREFIX_ONLY_BUILTINS: ReadonlySet<string> = new Set([
  'ffi', 'sea', 'sqlite', 'test', 'test/reporters',
]);
