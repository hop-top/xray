import * as path from 'path';
import Graph from 'graphology';
import { Tag, Import } from '../parser/types';
import { AsyncEventEmitter } from '../events/async-emitter';
import { GoModule, goPackageDir, goDefaultName } from './go-resolver';
import { XrayGraph, NodeAttributes, EdgeAttributes, Confidence } from '../../types/graph';

interface GraphBuilderEvents {
  'node:add': {
    nodeId: string;
    attrs: NodeAttributes;
    skip?: boolean;
  };

  'edge:add': {
    source: string;
    target: string;
    type: 'defines' | 'calls' | 'imports';
    attrs?: EdgeAttributes;
    skip?: boolean;
  };

  'reference:resolve': {
    sourceTag: string;
    targetName: string;
    resolved: string[];
  };

  'error': {
    event: string;
    error: Error;
    payload: any;
  };
}

export class GraphBuilder extends AsyncEventEmitter<GraphBuilderEvents> {
  private graph: XrayGraph;
  private pendingReferences: Map<string, { tagId: string, references: string[] }> = new Map();
  // file (relative path) -> list of raw import specifiers to resolve in a deferred pass
  private pendingImports: Map<string, string[]> = new Map();

  // Module context enabling `pkg.Func()` resolution in Go files (optional).
  private goModule: GoModule | null = null;
  // Go file -> imports (needed to map a call's package qualifier to a directory)
  private goImports: Map<string, Import[]> = new Map();

  constructor() {
    super();
    this.graph = new Graph<NodeAttributes, EdgeAttributes>({ multi: true, type: 'directed' });
  }

  /** Enable resolution of Go package-qualified calls inside this module. */
  setGoModule(mod: GoModule | null) {
    this.goModule = mod;
  }

  async addFile(file: string, tags: Tag[], imports: Import[]) {
    // Add File Node
    if (!this.graph.hasNode(file)) {
      const nodeEvent = { nodeId: file, attrs: { type: 'file' as const, label: file }, skip: false };
      await this.emitAsync('node:add', nodeEvent);

      if (!nodeEvent.skip) {
        this.graph.addNode(file, nodeEvent.attrs);
      }
    }

    // Collect all node events first
    const nodeEvents: Array<{ nodeId: string, attrs: NodeAttributes, skip: boolean, tagId: string }> = [];
    const edgeEvents: Array<{ source: string, target: string, type: 'defines', attrs: EdgeAttributes, skip: boolean }> = [];

    for (const tag of tags) {
      const tagId = `${file}::${tag.name}`;
      if (!this.graph.hasNode(tagId)) {
        nodeEvents.push({
          nodeId: tagId,
          tagId,
          attrs: {
            type: 'tag',
            label: tag.name,
            kind: tag.kind,
            file: file,
            line: tag.line,
            endLine: tag.endLine,
            signature: tag.signature,
            doc: tag.doc
          },
          skip: false
        });
      }

      // Store references for later edge creation
      if (tag.references && tag.references.length > 0) {
        this.pendingReferences.set(tagId, { tagId, references: tag.references });
      }
    }

    // Emit node events sequentially (attach-order) so mutation plugins
    // listening on `graph:add-node` see deterministic ordering and can
    // mutate `event.attrs` / set `event.skip` without racing each other.
    if (nodeEvents.length > 0) {
      for (const event of nodeEvents) {
        await this.emitAsync('node:add', event);
      }

      // Add nodes that weren't skipped
      for (const event of nodeEvents) {
        if (!event.skip) {
          this.graph.addNode(event.nodeId, event.attrs);
        }
      }
    }

    // Now collect edge events for tags that were added
    for (const event of nodeEvents) {
      if (!event.skip && this.graph.hasNode(file) && this.graph.hasNode(event.tagId)) {
        edgeEvents.push({
          source: file,
          target: event.tagId,
          type: 'defines',
          attrs: { type: 'defines', confidence: Confidence.EXTRACTED },
          skip: false
        });
      }
    }

    // Emit edge events sequentially to honour the `@emission sequential`
    // contract on `graph:add-edge` — mutation plugins must see edges in
    // attach order and be able to set `event.skip` deterministically.
    if (edgeEvents.length > 0) {
      for (const event of edgeEvents) {
        await this.emitAsync('edge:add', event);
      }

      // Add edges that weren't skipped
      for (const event of edgeEvents) {
        if (!event.skip) {
          this.graph.addEdge(event.source, event.target, event.attrs);
        }
      }
    }

    if (imports && imports.length > 0 && file.endsWith('.go')) {
      this.goImports.set(file, imports);
    }

    // Store imports as an attribute on the file node (back-compat readers).
    if (imports && imports.length > 0) {
      // Store full import objects
      this.graph.mergeNodeAttributes(file, { imports: imports });

      // Stash raw import specifiers for a deferred resolution pass in getGraph().
      // Rationale: imports may reference files not yet added (iteration order).
      // Mirrors the `buildReferenceEdges` pattern below.
      const specifiers: string[] = [];
      for (const imp of imports) {
        if (imp && typeof imp.source === 'string' && imp.source.length > 0) {
          specifiers.push(imp.source);
        }
      }
      if (specifiers.length > 0) {
        const existing = this.pendingImports.get(file);
        if (existing) {
          existing.push(...specifiers);
        } else {
          this.pendingImports.set(file, specifiers);
        }
      }
    }
  }

  async loadFromCache(file: string, tags: Tag[], imports: Import[]): Promise<void> {
    await this.addFile(file, tags, imports);
  }

  async getGraph(): Promise<XrayGraph> {
    // Build reference edges before returning graph
    await this.buildReferenceEdges();
    // Resolve pending imports into real `imports` edges now that all file
    // nodes have been added.
    await this.buildImportEdges();
    return this.graph;
  }

  /**
   * Resolve deferred import specifiers into `imports` edges.
   *
   * Minimum-viable resolver: relative path resolution against the set of
   * known file nodes. External specifiers (not starting with `.` or `/`)
   * are skipped. Tries common TS/JS extensions plus `/index.*`.
   *
   * TODO (spec OQ1): alias / tsconfig-paths / package.json `exports`
   * resolution is intentionally out of scope for this pass.
   */
  private async buildImportEdges() {
    if (this.pendingImports.size === 0) return;

    // Build a set of known file-node IDs for O(1) lookups. File nodes are
    // keyed by the relative project path handed to `addFile`.
    const fileNodes = new Set<string>();
    this.graph.forEachNode((nodeId: string, attrs: NodeAttributes) => {
      if (attrs.type === 'file') {
        fileNodes.add(nodeId);
      }
    });

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const indexSuffixes = [
      '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
      '/index.mjs', '/index.cjs'
    ];

    const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
      // Skip externals — only relative (`.`, `..`) or absolute specifiers.
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        return null;
      }

      const fromDir = path.posix.dirname(fromFile.split(path.sep).join('/'));
      const normalizedSpec = specifier.split(path.sep).join('/');
      // For absolute specifiers, strip leading slash so we resolve within the
      // project root (files nodes are relative paths).
      const base = normalizedSpec.startsWith('/')
        ? path.posix.normalize(normalizedSpec.slice(1))
        : path.posix.normalize(path.posix.join(fromDir, normalizedSpec));

      // 1) Exact match (specifier already includes extension)
      if (fileNodes.has(base)) return base;

      // 2) Try common extensions
      for (const ext of extensions) {
        const candidate = base + ext;
        if (fileNodes.has(candidate)) return candidate;
      }

      // 3) Try directory/index.*
      for (const idx of indexSuffixes) {
        const candidate = base + idx;
        if (fileNodes.has(candidate)) return candidate;
      }

      return null;
    };

    const edgeEvents: Array<{
      source: string;
      target: string;
      type: 'imports';
      attrs: EdgeAttributes;
      skip: boolean;
    }> = [];

    // Dedupe by (source, target): multiple `import` statements from the
    // same file resolving to the same target should produce one edge.
    // Prevents output bloat and keeps `GraphSerializer.deserialize`
    // round-trips safe even when the consumer uses a non-multi graph.
    const seen = new Set<string>();
    for (const [file, specifiers] of this.pendingImports.entries()) {
      if (!this.graph.hasNode(file)) continue;
      for (const specifier of specifiers) {
        const resolved = resolveSpecifier(file, specifier);
        if (!resolved) continue;
        if (resolved === file) continue; // self-import
        const key = `${file}\x00${resolved}`;
        if (seen.has(key)) continue;
        // Also skip if an `imports` edge already exists from a prior pass.
        if (this.graph.hasEdge(file, resolved)) {
          // Defensive: only skip when an imports-typed edge is already present
          // (defines/calls edges between the same nodes are still valid).
          let hasImports = false;
          this.graph.forEachEdge(file, resolved, (_: string, attrs: any) => {
            if (attrs?.type === 'imports') hasImports = true;
          });
          if (hasImports) {
            seen.add(key);
            continue;
          }
        }
        seen.add(key);
        edgeEvents.push({
          source: file,
          target: resolved,
          type: 'imports',
          attrs: { type: 'imports', confidence: Confidence.EXTRACTED },
          skip: false
        });
      }
    }

    if (edgeEvents.length === 0) return;

    // Emit sequentially to honour attach-order mutation semantics (listeners
    // may flip `skip` or mutate attrs).
    for (const event of edgeEvents) {
      await this.emitAsync('edge:add', event);
    }

    for (const event of edgeEvents) {
      if (!event.skip) {
        this.graph.addEdge(event.source, event.target, event.attrs);
      }
    }
  }

  private async buildReferenceEdges() {
    // Create a map of tag names to tag IDs for efficient lookups
    const tagNameMap = new Map<string, string[]>();
    // Exported, non-test Go functions by package directory then name.
    const goFuncs = new Map<string, Map<string, string[]>>();
    this.graph.forEachNode((nodeId: string, attrs: NodeAttributes) => {
      if (attrs.type === 'tag') {
        if (this.goModule && attrs.kind === 'function' && attrs.file.endsWith('.go') &&
            !attrs.file.endsWith('_test.go') && /^[A-Z]/.test(attrs.label)) {
          const dir = path.posix.dirname(attrs.file.split(path.sep).join('/'));
          let byName = goFuncs.get(dir);
          if (!byName) goFuncs.set(dir, (byName = new Map()));
          const list = byName.get(attrs.label);
          if (list) list.push(nodeId); else byName.set(attrs.label, [nodeId]);
        }
        const tagName = attrs.label;
        if (!tagNameMap.has(tagName)) {
          tagNameMap.set(tagName, []);
        }
        tagNameMap.get(tagName)!.push(nodeId);
      }
    });

    // Collect all reference resolution events first
    const resolveEvents: Array<{ sourceTag: string, targetName: string, resolved: string[] }> = [];
    // Events resolved through go.mod + import paths rather than a bare name.
    const goResolved = new WeakSet<object>();

    for (const { tagId, references } of this.pendingReferences.values()) {
      for (const refName of references) {
        if (this.goModule && refName.includes('.')) {
          const targets = this.resolveGoQualified(tagId, refName, goFuncs);
          if (targets.length > 0) {
            const ev = { sourceTag: tagId, targetName: refName, resolved: targets };
            goResolved.add(ev);
            resolveEvents.push(ev);
          }
          continue;
        }
        const targetTags = tagNameMap.get(refName);
        if (targetTags) {
          // Event: Reference resolution (listeners can modify targets)
          resolveEvents.push({
            sourceTag: tagId,
            targetName: refName,
            resolved: [...targetTags]
          });
        }
      }
    }

    // Emit all reference resolution events in parallel
    if (resolveEvents.length > 0) {
      await Promise.all(resolveEvents.map(event =>
        this.emitAsync('reference:resolve', event)
      ));
    }

    // Now collect all edge events based on resolved references
    const edgeEvents: Array<{ source: string, target: string, type: 'calls', attrs: EdgeAttributes, skip: boolean }> = [];

    const queued = new Set<string>();
    for (const resolveEvent of resolveEvents) {
      for (const targetTagId of resolveEvent.resolved) {
        // Avoid self-references
        if (targetTagId !== resolveEvent.sourceTag) {
          // Only add edge if it doesn't already exist
          const key = `${resolveEvent.sourceTag}\x00${targetTagId}`;
          if (!queued.has(key) && !this.graph.hasEdge(resolveEvent.sourceTag, targetTagId)) {
            queued.add(key);
            edgeEvents.push({
              source: resolveEvent.sourceTag,
              target: targetTagId,
              type: 'calls',
              attrs: {
                type: 'calls',
                // Import-path resolution goes through go.mod, not the source text alone.
                confidence: goResolved.has(resolveEvent) ? Confidence.INFERRED : Confidence.EXTRACTED
              },
              skip: false
            });
          }
        }
      }
    }

    // Emit edge events sequentially to honour `@emission sequential` on
    // `graph:add-edge` (see addFile() for the same rationale).
    if (edgeEvents.length > 0) {
      for (const event of edgeEvents) {
        await this.emitAsync('edge:add', event);
      }

      // Add edges that weren't skipped
      for (const event of edgeEvents) {
        if (!event.skip) {
          this.graph.addEdge(event.source, event.target, event.attrs);
        }
      }
    }
  }

  /**
   * Resolve a Go `pkg.Func` reference from tag `tagId` to function tags in the
   * module-local package that `pkg` names in the tag's file. Anything else
   * (external packages, blank/dot imports, locals shadowing nothing known,
   * method calls on values) yields no targets.
   */
  private resolveGoQualified(
    tagId: string,
    ref: string,
    goFuncs: Map<string, Map<string, string[]>>
  ): string[] {
    const mod = this.goModule;
    if (!mod || !this.graph.hasNode(tagId)) return [];
    const file = (this.graph.getNodeAttributes(tagId) as any).file as string | undefined;
    if (!file || !file.endsWith('.go')) return [];
    const dot = ref.indexOf('.');
    const qualifier = ref.slice(0, dot);
    const name = ref.slice(dot + 1);
    if (!qualifier || !name || name.includes('.')) return [];

    const out: string[] = [];
    for (const imp of this.goImports.get(file) ?? []) {
      if (imp.alias === '_' || imp.alias === '.') continue;
      if ((imp.alias || goDefaultName(imp.source)) !== qualifier) continue;
      const dir = goPackageDir(mod, imp.source);
      if (dir === null) continue;
      for (const t of goFuncs.get(dir)?.get(name) ?? []) out.push(t);
    }
    return out;
  }
}
