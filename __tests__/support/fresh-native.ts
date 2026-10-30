/**
 * Per-suite native addon isolation.
 *
 * Jest gives every suite a fresh module registry, but `.node` addons are
 * loaded through Node's real `require`, whose cache outlives the registry.
 * tree-sitter's JS wrapper patches the shared native classes at load time
 * (e.g. `Tree.prototype.rootNode`); a second suite in the same process
 * re-patches already-patched prototypes and `tree.rootNode` comes back
 * undefined, so parses silently produce no symbols.
 *
 * Dropping the cached addons before each suite makes Node re-initialise them,
 * giving every suite pristine native classes.
 */
import Module = require('module');

const cache = (Module as unknown as { _cache: Record<string, unknown> })._cache;
for (const key of Object.keys(cache)) {
  if (key.endsWith('.node')) delete cache[key];
}
