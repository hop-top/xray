/**
 * Interactive TTY driver for the xray TUI explorer.
 *
 * Bridges `WarmWorkspaceManager`, `TrigramIndex`, `computeImpact`, `git`, and
 * `readTextSafe` to the pure state/renderer in `./screen`.
 */
import * as path from 'path';
import { execFileNoThrow } from '../../utils/execFileNoThrow';
import { getFileBlame, listCommits } from '../git';
import { WarmWorkspaceManager } from '../mcp/workspace';
import { computeImpact, editorLine } from '../query/impact';
import { findNodes } from '../query/match';
import { readTextSafe } from '../safe-read';
import { styles as createStyles } from '../tui';
import type { XrayGraph } from '../../types/graph';
import {
  createInitialState,
  ENTER_ALT_SCREEN,
  EXIT_ALT_SCREEN,
  handleKey,
  parseKeypress,
  renderFrame,
  type CommitItem,
  type ImpactJumpItem,
  type SymbolInfo,
  type TreeFileEntry,
  type TuiAction,
  type TuiState,
  type Viewport,
} from './screen';

export interface TuiAppOptions {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  cols?: number;
  rows?: number;
}

function collectFilesFromGraph(graph: XrayGraph, rankedNodes: Array<{ id?: string; score?: number }>): TreeFileEntry[] {
  const rankByFile = new Map<string, number>();
  for (const r of rankedNodes) {
    if (r.id && typeof r.score === 'number') {
      rankByFile.set(r.id, r.score);
    }
  }

  const entries: TreeFileEntry[] = [];
  graph.forEachNode((nodeId, attrs) => {
    if (attrs.type !== 'file') return;
    let symbolCount = 0;
    graph.forEachOutEdge(nodeId, (_e, eAttrs, _s, _t, _sa, tAttrs) => {
      if (eAttrs?.type === 'defines' && tAttrs?.type === 'tag') {
        symbolCount++;
      }
    });
    const attrRank = typeof attrs.pagerank === 'number' ? attrs.pagerank : 0;
    const rank = rankByFile.get(nodeId) ?? attrRank;
    entries.push({
      relPath: nodeId,
      symbolCount,
      isHub: false,
      rank,
    });
  });

  // Mark top PageRank hubs (top 10%, at least 1 if any have positive rank or symbols)
  const sortedByRank = [...entries].sort((a, b) => b.rank - a.rank || b.symbolCount - a.symbolCount);
  const hubCount = Math.min(sortedByRank.length, Math.max(1, Math.ceil(sortedByRank.length * 0.1)));
  const hubSet = new Set(
    sortedByRank
      .slice(0, hubCount)
      .filter((e) => e.rank > 0 || e.symbolCount > 0)
      .map((e) => e.relPath)
  );
  for (const entry of entries) {
    entry.isHub = hubSet.has(entry.relPath);
  }

  return entries;
}

function collectFileSymbols(graph: XrayGraph, relPath: string): SymbolInfo[] {
  if (!graph.hasNode(relPath)) return [];
  const symbols: SymbolInfo[] = [];
  graph.forEachOutEdge(relPath, (_e, eAttrs, _s, target, _sa, tAttrs) => {
    if (eAttrs?.type !== 'defines' || tAttrs?.type !== 'tag') return;
    const line = typeof tAttrs.line === 'number' ? tAttrs.line + 1 : 1;
    const endLine = typeof tAttrs.endLine === 'number' ? tAttrs.endLine + 1 : undefined;
    symbols.push({
      id: target,
      name: String(tAttrs.label ?? target),
      kind: String(tAttrs.kind ?? 'symbol'),
      file: relPath,
      line,
      ...(endLine !== undefined ? { endLine } : {}),
    });
  });
  symbols.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return symbols;
}

export async function runTuiApp(targetRoot: string, opts: TuiAppOptions = {}): Promise<void> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const root = path.resolve(targetRoot);

  const getViewport = (): Viewport => ({
    cols: opts.cols ?? (stdout as { columns?: number }).columns ?? 100,
    rows: opts.rows ?? (stdout as { rows?: number }).rows ?? 30,
  });

  const manager = new WarmWorkspaceManager(root);
  const workspace = await manager.getGraph(root);
  const files = collectFilesFromGraph(workspace.graph, workspace.rankedNodes);
  const trigramIndex = manager.getTrigramIndex(root);
  trigramIndex.sync(root, files.map((f) => f.relPath));

  let state: TuiState = createInitialState(files, path.basename(root));
  const streamStyles = createStyles(stdout);

  const loadFileIntoState = async (s: TuiState, relPath: string, targetLine?: number): Promise<TuiState> => {
    let lines: string[] = [];
    try {
      lines = readTextSafe(root, relPath).split('\n');
    } catch {
      lines = [`(unable to read ${relPath})`];
    }
    const symbols = collectFileSymbols(workspace.graph, relPath);
    const line = targetLine ? Math.max(1, Math.min(lines.length || 1, targetLine)) : 1;
    const vp = getViewport();
    const visibleCode = Math.max(1, vp.rows - 4);
    const scroll = Math.max(0, Math.min(Math.max(0, lines.length - visibleCode), line - Math.floor(visibleCode / 3) - 1));

    let blameByLine = s.blameByLine;
    if (s.showBlame) {
      const blame = await getFileBlame(root, relPath);
      blameByLine = new Map(blame.map((b) => [b.line, b]));
    } else {
      blameByLine = new Map();
    }

    return {
      ...s,
      selectedFile: relPath,
      fileLines: lines,
      fileSymbols: symbols,
      codeCursorLine: line,
      codeScroll: scroll,
      blameByLine,
      statusMessage: `${relPath} (${lines.length} lines)`,
    };
  };

  if (state.selectedFile) {
    state = await loadFileIntoState(state, state.selectedFile);
  }

  const draw = () => {
    stdout.write(renderFrame(state, getViewport(), streamStyles));
  };

  const applyEffect = async (effect: TuiAction): Promise<boolean> => {
    switch (effect.type) {
      case 'none':
        return true;
      case 'quit':
        return false;
      case 'loadFile':
        state = await loadFileIntoState(state, effect.relPath, effect.targetLine);
        return true;
      case 'loadBlame': {
        const blame = await getFileBlame(root, effect.relPath);
        state = {
          ...state,
          blameByLine: new Map(blame.map((b) => [b.line, b])),
          statusMessage: `Blame loaded (${blame.length} lines)`,
        };
        return true;
      }
      case 'loadHistory': {
        const res = await listCommits(root, { perPage: 40 });
        const commits: CommitItem[] = res.commits.map((c) => ({
          sha: c.sha,
          shortSha: c.shortSha,
          authorName: c.authorName,
          authorDate: c.authorDate,
          subject: c.subject,
        }));
        state = {
          ...state,
          commits,
          commitCursor: 0,
          statusMessage: `${commits.length} commits`,
        };
        return true;
      }
      case 'loadCommitDiff': {
        if (effect.sha.startsWith('-')) return true;
        const res = await execFileNoThrow('git', ['-C', root, 'show', '--format=medium', '--patch', effect.sha]);
        const diffLines = res.status === 0 ? res.stdout.split('\n') : [`(git show failed: ${res.stderr.trim()})`];
        state = {
          ...state,
          diffLines,
          diffScroll: 0,
          statusMessage: `Diff ${effect.sha.slice(0, 7)}`,
        };
        return true;
      }
      case 'runSearch': {
        if (!effect.query.trim()) {
          state = { ...state, searchResults: [], searchCursor: 0 };
          return true;
        }
        const res = trigramIndex.search(effect.query, { limit: 50 });
        state = {
          ...state,
          searchResults: res.matches.map((m) => ({
            relPath: m.relPath,
            line: m.line,
            content: m.content,
          })),
          searchCursor: 0,
          statusMessage: `${res.total} search match(es)`,
        };
        return true;
      }
      case 'runImpact': {
        const res = computeImpact(workspace.graph, effect.symbol);
        const items: ImpactJumpItem[] = [];
        for (const node of res.nodes) {
          const defLine = editorLine(node.line) ?? 1;
          const file = node.file ?? '';
          if (node.callSites && node.callSites.length > 0) {
            for (const site of node.callSites) {
              items.push({
                callerName: node.name,
                callerId: node.id,
                file,
                line: defLine,
                depth: node.depth,
                confidence: node.confidence,
                callSiteLine: site.line + 1,
              });
            }
          } else {
            items.push({
              callerName: node.name,
              callerId: node.id,
              file,
              line: defLine,
              depth: node.depth,
              confidence: node.confidence,
            });
          }
        }
        state = {
          ...state,
          impactItems: items,
          impactCursor: 0,
          statusMessage: `Impact: ${res.counts.callers} caller(s) for ${effect.symbol}`,
        };
        return true;
      }
      case 'jumpDefinition': {
        const lineText = state.fileLines[effect.currentLine - 1] ?? '';
        const words = lineText.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
        let matches: string[] = [];
        let resolvedName = effect.symbol;
        for (const w of words) {
          if (w === effect.symbol) continue;
          const found = findNodes(w, workspace.graph);
          if (found.length > 0) {
            matches = found;
            resolvedName = w;
            break;
          }
        }
        if (matches.length === 0) {
          matches = findNodes(effect.symbol, workspace.graph);
        }
        if (matches.length === 0) {
          state = { ...state, statusMessage: `No definition found for ${effect.symbol}` };
          return true;
        }
        const targetId =
          matches.find((id) => {
            const a = workspace.graph.getNodeAttributes(id);
            return a.file !== effect.currentFile || (editorLine(a.line) ?? 1) !== effect.currentLine;
          }) ?? matches[0];
        const attrs = workspace.graph.getNodeAttributes(targetId);
        if (attrs.file) {
          state = await loadFileIntoState(state, String(attrs.file), editorLine(attrs.line) ?? 1);
          state = { ...state, focus: 'code', statusMessage: `Definition: ${attrs.label ?? resolvedName}` };
        }
        return true;
      }
    }
  };

  if (typeof stdin.setRawMode === 'function') {
    stdin.setRawMode(true);
  }
  stdin.resume();
  stdout.write(ENTER_ALT_SCREEN);
  draw();

  await new Promise<void>((resolve) => {
    let settled = false;
    let queue: Promise<void> = Promise.resolve();

    const cleanup = () => {
      if (settled) return;
      settled = true;
      stdin.off('data', onData);
      stdout.off('resize', onResize);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      if (typeof stdin.setRawMode === 'function') {
        try {
          stdin.setRawMode(false);
        } catch {
          // ignore stream teardown errors
        }
      }
      stdin.pause();
      stdout.write(EXIT_ALT_SCREEN);
      manager.close();
      resolve();
    };

    const onResize = () => {
      if (!settled) draw();
    };

    const onSignal = () => {
      cleanup();
    };

    const onData = (chunk: Buffer | string) => {
      const keys = parseKeypress(chunk);
      queue = queue.then(async () => {
        for (const key of keys) {
          if (settled) return;
          const res = handleKey(state, key, getViewport());
          state = res.state;
          const keepGoing = await applyEffect(res.effect);
          if (!keepGoing) {
            cleanup();
            return;
          }
          draw();
        }
      });
    };

    stdin.on('data', onData);
    stdout.on('resize', onResize);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}
