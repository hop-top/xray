import * as path from 'path';
import Graph from 'graphology';
import { Tag, Import } from '../parser/types';
import { AsyncEventEmitter } from '../events/async-emitter';
import { GoModules, goDefaultName, goLocalImports, goImportedFiles, goVisibleFrom } from './go-resolver';
import { resolveTsSpecifier } from './ts-specifier';
import { resolveImports, type ResolveInput } from '../imports/resolve';
import { contractLanguageOf } from '../imports/tree';
import type { FileImports, ImportRecord } from '../imports/types';
import { languageOf } from '../parser/language-registry';
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
    /**
     * Set only when the builder declined to pick targets (`resolved` empty)
     * because the name matched in several unrelated packages. Targets a
     * listener adds anyway are stamped with this confidence.
     */
    confidence?: Confidence;
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
  private goModule: GoModules | null = null;
  // Go file -> imports (needed to map a call's package qualifier to a directory)
  private goImports: Map<string, Import[]> = new Map();

  // File -> imports-contract records (contract languages), resolved in getGraph().
  private importRecords: Map<string, ImportRecord[]> = new Map();
  // Files outside the graph the resolution pass reads (go.mod, package.json, ...).
  private resolutionInputs: ResolveInput[] = [];

  constructor() {
    super();
    this.graph = new Graph<NodeAttributes, EdgeAttributes>({ multi: true, type: 'directed' });
  }

  /** Enable resolution of Go package-qualified calls inside these modules. */
  setGoModule(mod: GoModules | null) {
    this.goModule = mod;
  }

  /**
   * Manifests (root-relative posix path + content) the imports resolution
   * pass reads besides the graph's file nodes. Inputs only: no nodes.
   */
  setResolutionInputs(inputs: ResolveInput[]) {
    this.resolutionInputs = inputs;
  }

  /**
   * `records`: the file's imports-contract records (ParserManager.parse,
   * contract languages). With them, `imports` edges come from the records'
   * `resolved.file`; without, from relative specifiers in `imports`.
   */
  async addFile(file: string, tags: Tag[], imports: Import[], records?: ImportRecord[]) {
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
            doc: tag.doc,
            ...(tag.cfg ? { cfg: tag.cfg } : {}),
            ...(tag.dfg ? { dfg: tag.dfg } : {})
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

    if (records && records.length > 0) this.importRecords.set(file, records);

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

  async loadFromCache(file: string, tags: Tag[], imports: Import[], records?: ImportRecord[]): Promise<void> {
    await this.addFile(file, tags, imports, records);
  }

  async getGraph(): Promise<XrayGraph> {
    // Resolve pending imports into real `imports` edges now that all file
    // nodes have been added. Runs first: reference resolution ranks
    // candidates in imported files above the global name match.
    await this.buildImportEdges();
    await this.buildReferenceEdges();
    return this.graph;
  }

  /**
   * Resolve deferred import specifiers into `imports` edges.
   *
   * Files with contract records: the imports contract resolution pass
   * (src/lib/imports/resolve) over the graph's file nodes plus the
   * resolution inputs; each record whose module the file's `imports` still
   * list and that resolved to a file node gives an edge. Specifiers no
   * record covers (other languages, entries a plugin added) fall back to
   * relative path resolution against the file nodes (common TS/JS
   * extensions plus `/index.*`).
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

    const resolvedTargets = this.resolveRecordTargets(fileNodes);
    const resolveSpecifier = (fromFile: string, specifier: string): string | null => {
      const byRecord = resolvedTargets.get(fromFile);
      if (byRecord?.has(specifier)) return byRecord.get(specifier) ?? null;
      return resolveTsSpecifier(fromFile, specifier, f => fileNodes.has(f));
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

  /**
   * File -> (record module -> resolved file node, or null when the record
   * resolved to nothing in the graph). Covers files with contract records.
   */
  private resolveRecordTargets(fileNodes: Set<string>): Map<string, Map<string, string | null>> {
    const out = new Map<string, Map<string, string | null>>();
    if (this.importRecords.size === 0) return out;
    const posix = (f: string) => f.split(path.sep).join('/');
    const entries: Array<{ file: string; entry: FileImports }> = [];
    for (const [file, records] of this.importRecords) {
      const language = contractLanguageOf(posix(file));
      if (!language || !fileNodes.has(file)) continue;
      entries.push({
        file,
        entry: {
          path: posix(file), language, sha256: '', status: 'ok', complete: true,
          parseErrors: [], imports: records, unsupported: [],
        },
      });
    }
    // Sources are only tested for presence; manifests carry their text.
    const inputs: ResolveInput[] = [...fileNodes].map(f => ({ path: posix(f), content: '' }));
    inputs.push(...this.resolutionInputs);
    resolveImports(entries.map(e => e.entry), inputs);
    const nodeOf = new Map([...fileNodes].map(f => [posix(f), f]));
    for (const { file, entry } of entries) {
      const targets = new Map<string, string | null>();
      for (const r of entry.imports) {
        if (r.kind === 'reference') continue;
        const target = r.resolved && 'file' in r.resolved ? nodeOf.get(r.resolved.file) ?? null : null;
        // Several records per module (Rust leaves, repeated imports): any hit wins.
        if (target !== null || !targets.has(r.module)) targets.set(r.module, target);
      }
      out.set(file, targets);
    }
    return out;
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
    const resolveEvents: Array<{ sourceTag: string, targetName: string, resolved: string[], confidence?: Confidence }> = [];
    // Events resolved by a bare name with no file/package/import scope
    // backing it (global name match).
    const inferred = new WeakSet<object>();
    const importedFiles = this.importTargetsByFile();
    // Go: files of module-local packages each file imports. Member calls
    // (`.Name`) may hit any imported package; bare names only dot imports
    // (a plain import never puts another package's names in scope).
    const goFiles: string[] = [];
    this.graph.forEachNode((id: string, attrs: NodeAttributes) => {
      if (attrs.type === 'file' && id.endsWith('.go')) goFiles.push(id);
    });
    const goImported = goImportedFiles(this.goModule, this.goImports, goFiles, false);
    const goDotImported = goImportedFiles(this.goModule, this.goImports, goFiles, true);
    const isGo = (id: string) => this.goModule !== null &&
      ((this.graph.getNodeAttributes(id) as any).file as string | undefined)?.endsWith('.go') === true;

    // Tag -> references that resolved nothing in this graph (raw form).
    // Kept on the tag node as `references` for a later cross-root pass.
    const unresolved = new Map<string, string[]>();
    const miss = (tagId: string, refName: string) => {
      const list = unresolved.get(tagId);
      if (list) { if (!list.includes(refName)) list.push(refName); } else unresolved.set(tagId, [refName]);
    };

    for (const { tagId, references } of this.pendingReferences.values()) {
      for (const refName of references) {
        // `.name`: member call on a value receiver (parser marker); no
        // receiver type info, so only method tags are candidates.
        if (refName.startsWith('.')) {
          const name = refName.slice(1);
          const callerFile = (this.graph.getNodeAttributes(tagId) as any).file as string | undefined;
          const callerLang = callerFile === undefined ? undefined : languageOf(path.extname(callerFile));
          const methods = (tagNameMap.get(name) ?? []).filter(id => {
            const attrs = this.graph.getNodeAttributes(id) as NodeAttributes & { file?: string };
            if (attrs.kind !== 'method') return false;
            // A member call only reaches methods of the caller's language.
            if (callerLang !== undefined && attrs.file !== undefined &&
                languageOf(path.extname(attrs.file)) !== callerLang) return false;
            // Go caller -> Go method: apply package visibility rules.
            return !(callerFile?.endsWith('.go') && attrs.file?.endsWith('.go')) ||
              goVisibleFrom(callerFile, attrs.file, name);
          });
          if (methods.length > 0) {
            const goCaller = isGo(tagId);
            const { resolved, scoped } = this.rankCandidates(tagId, methods, goCaller ? goImported : importedFiles);
            if (!scoped && goCaller) {
              // Go member call with no file/package/import scope: the
              // receiver type is unknown, so a global name match is a guess.
              //  - caller imports no module-local package (stdlib/external
              //    only, e.g. `t.Errorf` in a test): the receiver cannot be a
              //    repo type -> no edge.
              //  - candidates span >1 package: AMBIGUOUS -> no edge (recorded
              //    on the event only).
              //  - one candidate package: keep the INFERRED guess.
              if ((goImported.get(callerFile!)?.size ?? 0) === 0) { miss(tagId, refName); continue; }
              const pkgs = new Set(resolved.map(id => path.posix.dirname(
                ((this.graph.getNodeAttributes(id) as any).file as string).split(path.sep).join('/'))));
              if (pkgs.size > 1) {
                resolveEvents.push({ sourceTag: tagId, targetName: name, resolved: [], confidence: Confidence.AMBIGUOUS });
                continue;
              }
            }
            const ev = { sourceTag: tagId, targetName: name, resolved };
            if (!scoped) inferred.add(ev);
            resolveEvents.push(ev);
          } else {
            miss(tagId, refName);
          }
          continue;
        }
        if (this.goModule && refName.includes('.')) {
          const targets = this.resolveGoQualified(tagId, refName, goFuncs);
          if (targets.length > 0) {
            // Explicit import + module path + exported name: EXTRACTED.
            resolveEvents.push({ sourceTag: tagId, targetName: refName, resolved: targets });
          } else {
            miss(tagId, refName);
          }
          continue;
        }
        const targetTags = tagNameMap.get(refName);
        if (targetTags) {
          const { resolved, scoped } = this.rankCandidates(tagId, targetTags, isGo(tagId) ? goDotImported : importedFiles);
          // Event: Reference resolution (listeners can modify targets)
          const ev = { sourceTag: tagId, targetName: refName, resolved };
          if (!scoped) inferred.add(ev);
          resolveEvents.push(ev);
        } else {
          miss(tagId, refName);
        }
      }
    }
    for (const [tagId, refs] of unresolved) {
      if (this.graph.hasNode(tagId)) this.graph.mergeNodeAttributes(tagId, { references: refs });
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
                // EXTRACTED = resolved through file/dir/import/module
                // evidence; INFERRED = name match only.
                confidence: resolveEvent.confidence ??
                  (inferred.has(resolveEvent) ? Confidence.INFERRED : Confidence.EXTRACTED)
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

  /** File node -> files it has an `imports` edge to. */
  private importTargetsByFile(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    this.graph.forEachEdge((_e: string, attrs: EdgeAttributes, source: string, target: string) => {
      if (attrs.type !== 'imports') return;
      let set = out.get(source);
      if (!set) out.set(source, (set = new Set()));
      set.add(target);
    });
    return out;
  }

  /**
   * Narrow same-named candidate tags to the best scope tier relative to the
   * referencing tag: same file, then same directory (a Go package), then a
   * file the caller's file imports. With no tier matching, every candidate is
   * returned and `scoped` is false (global name match).
   */
  private rankCandidates(
    sourceTag: string,
    candidates: string[],
    importedFiles: Map<string, Set<string>>
  ): { resolved: string[]; scoped: boolean } {
    const fileOf = (id: string): string | undefined =>
      (this.graph.getNodeAttributes(id) as NodeAttributes & { file?: string }).file;
    const dirOf = (file: string) => path.posix.dirname(file.split(path.sep).join('/'));

    const callerFile = fileOf(sourceTag);
    if (callerFile === undefined) return { resolved: [...candidates], scoped: false };
    const callerDir = dirOf(callerFile);
    const imported = importedFiles.get(callerFile);

    const tiers: Array<(file: string) => boolean> = [
      (f) => f === callerFile,
      (f) => dirOf(f) === callerDir,
      (f) => imported !== undefined && imported.has(f),
    ];
    for (const inTier of tiers) {
      const hits = candidates.filter((id) => {
        const f = fileOf(id);
        return f !== undefined && inTier(f);
      });
      if (hits.length > 0) return { resolved: hits, scoped: true };
    }
    return { resolved: [...candidates], scoped: false };
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
    for (const { imp, dir } of goLocalImports(mod, this.goImports.get(file) ?? [])) {
      if (imp.alias === '.') continue;
      if ((imp.alias || goDefaultName(imp.source)) !== qualifier) continue;
      for (const t of goFuncs.get(dir)?.get(name) ?? []) out.push(t);
    }
    return out;
  }
}
