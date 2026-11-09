# Event System: Agent Integration Reference

**Target audience:** AI coding agents that write a custom `--preset` plugin.

xray has no library API: there is no `Xray` export to construct, no
`xray.use()`, and no `plugins` entry point. Events are reachable from one
place only: a plugin returned by a custom preset file loaded with
`--preset ./x.js` or `--preset @scope/pkg`. Setup, loading rules and
failure behavior: [docs/user/plugins.md](../user/plugins.md).

## Decision protocol

```
IF task is "skip/redact/annotate files, tags, nodes during map|graph" THEN
  write a preset plugin that listens to events
ELSE IF task is "support another language, query, or command" THEN
  write a strategy (see docs/user/strategies.md)
ELSE
  use CLI flags (--match, --catch, --query, --lens); no code
```

## Skeleton

```js
// my-preset.js
module.exports = (ctx) => [{
  name: 'my-plugin',
  apply(xray) {
    xray.on('scan:file', (e) => { if (e.file.includes('.test.')) e.skip = true; });
  },
}];
```

```bash
xray map -p src --preset ./my-preset.js
```

`xray` inside `apply` also offers `getLastGraph()`, `stash(ns, items)` and
`retrieve(ns, n)`. A plugin is `{ name, version?, apply(xray), dispose? }`;
a preset is `(ctx: { root, opts? }) => plugin[]`.

## Execution modes

| Mode | Symbol | Behavior | Use for |
|------|--------|----------|---------|
| Sequential | ⚡ | Listeners run one by one in registration order; later ones see earlier edits. | Filtering, transforming |
| Parallel | 🔀 | Listeners run concurrently on the same payload. Do not mutate. | Logging, metrics |

Listeners may be async; sequential events wait for them.

## Event reference

Emitted by `xray map` / `xray graph`. Mutable fields apply to ⚡ events.

| Event | Mode | Payload | Mutable |
|-------|------|---------|---------|
| `scan:start` | 🔀 | `path`, `config` | no |
| `scan:complete` | 🔀 | `files: string[]` | no |
| `scan:file` | ⚡ | `file` (path relative to the root), `skip?` | `skip` |
| `cache:check` | 🔀 | `file`, `mtime` | no |
| `cache:hit` | ⚡ | `file`, `tags`, `imports` | `tags`, `imports` |
| `cache:miss` | 🔀 | `file` | no |
| `cache:write` | ⚡ | `file`, `tags`, `imports` | `tags`, `imports` |
| `parse:before` | ⚡ | `file`, `content`, `skip?` | `content`, `skip` |
| `parse:after` | ⚡ | `file`, `tags`, `imports` | `tags`, `imports` |
| `parse:error` | ⚡ | `file`, `error`, `recovered?` | no |
| `graph:add-file` | ⚡ | `file`, `tags`, `imports`, `skip?` | `tags`, `imports`, `skip` |
| `graph:add-node` | ⚡ | `nodeId`, `attrs`, `skip?` | `attrs`, `skip` |
| `graph:add-edge` | ⚡ | `source`, `target`, `type`, `attrs?`, `skip?` | `attrs`, `skip` |
| `graph:complete` | 🔀 | `graph`, `nodeCount`, `edgeCount` | no |
| `rank:start` | 🔀 | `graph`, `anchor?` | no |
| `rank:complete` | ⚡ | `graph`, `rankedNodes` | `rankedNodes` |
| `render:start` | ⚡ | `format`, `chunked`, `outputPath`, `renderer` | renderer |
| `render:complete` | 🔀 | `outputPath`, `filesWritten` | no |
| `progress` | 🔀 | `stage`, `current`, `total`, `message` | no |
| `error` | ⚡ | `event`, `error`, `payload`, `recovered?` | no |
| `preset:applied` | 🔀 | `presetName`, `applied`, `skipped`, `errored`, `timings` | no |

Source of truth for payload types: `src/lib/events/types.ts`.

## Observed order (`xray map`)

```
scan:start -> scan:complete
for each file: scan:file -> cache:check -> cache:hit
                          | cache:miss -> parse:before -> parse:after
                                          -> graph:add-file (miss only)
               graph:add-node (per tag) / graph:add-edge
               cache:write (miss only)
graph:complete -> rank:start -> rank:complete -> render:start
render:complete (only with --no-chunk)
```

Consequences:

- `scan:file` fires after `scan:complete`, once per file as it is processed.
- `parse:before`, `parse:after` and `graph:add-file` never fire for files
  served from the cache. With `--preset` the per-file cache is bypassed:
  they fire for every file on every run, `cache:hit` never fires, and
  nothing is stored.
- `render:complete` does not fire in the default chunked output.
- `progress` fires with stages `scan` and `parsing`.
- Runs with `--preset` neither read nor write the per-file cache, so edits
  made in `parse:after` by a preset never reach later runs.

## Patterns

Filter private tags:

```js
xray.on('parse:after', (e) => {
  e.tags = e.tags.filter((t) => !t.name.startsWith('_'));
});
```

Collect counts and report at the end of the graph build:

```js
let tags = 0;
xray.on('parse:after', (e) => { tags += e.tags.length; });
xray.on('graph:complete', (e) => {
  console.error(`tags parsed: ${tags}; nodes: ${e.nodeCount}`);
});
```

Redact before parsing:

```js
xray.on('parse:before', (e) => {
  e.content = e.content.replace(/Bearer\s+\S+/g, 'Bearer [REDACTED]');
});
```

Print to stderr (`console.error`), not stdout, so output piped from xray
stays clean.

## Keep listeners cheap

Sequential events run on the hot path for every file. Push work into a
queue and process it on `graph:complete`.

## See also

- [Custom plugins via --preset](../user/plugins.md)
- [Strategies](../user/strategies.md)
- [Integration protocol](integration-protocol.md)
- [Output interpretation](output-interpretation.md)
