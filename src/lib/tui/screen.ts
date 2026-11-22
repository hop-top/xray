/**
 * Pure TUI state machine and ANSI frame renderer.
 *
 * Kept free of TTY/process I/O so tests can drive keypresses against a
 * virtual `{ cols, rows }` viewport without a PTY.
 */
import type * as KitTui from '@hop-top/kit/dist/tui';
import type { BlameLine } from '../git';
import { getTheme, stripAnsi, styles as createStyles, type Styles } from '../tui';

export const ENTER_ALT_SCREEN = '\x1b[?1049h\x1b[?25l';
export const EXIT_ALT_SCREEN = '\x1b[?1049l\x1b[?25h';

let kitTuiMod: typeof KitTui | undefined;
function kitTui(): typeof KitTui | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (kitTuiMod ??= require('@hop-top/kit/tui') as typeof KitTui);
  } catch {
    return null;
  }
}

export interface Viewport {
  cols: number;
  rows: number;
}

export interface SymbolInfo {
  id: string;
  name: string;
  kind: string;
  file: string;
  /** 1-based editor line number. */
  line: number;
  /** 1-based editor end line number. */
  endLine?: number;
}

export interface TreeFileEntry {
  relPath: string;
  symbolCount: number;
  isHub: boolean;
  rank: number;
}

export interface TreeNode {
  id: string;
  name: string;
  relPath: string;
  isDir: boolean;
  depth: number;
  expanded: boolean;
  symbolCount: number;
  isHub: boolean;
  children: TreeNode[];
}

export interface ImpactJumpItem {
  callerName: string;
  callerId: string;
  file: string;
  /** 1-based definition line. */
  line: number;
  depth: number;
  confidence: string;
  /** 1-based call-site line when available. */
  callSiteLine?: number;
}

export interface SearchResultItem {
  relPath: string;
  /** 1-based line number. */
  line: number;
  content: string;
}

export interface CommitItem {
  sha: string;
  shortSha: string;
  authorName: string;
  authorDate: string;
  subject: string;
}

export interface KeyEvent {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
}

export type ActiveMode = 'browse' | 'search' | 'history' | 'diff' | 'impact';
export type FocusPane = 'tree' | 'code' | 'drawer';

export type TuiAction =
  | { type: 'none' }
  | { type: 'quit' }
  | { type: 'loadFile'; relPath: string; targetLine?: number }
  | { type: 'loadBlame'; relPath: string }
  | { type: 'loadHistory'; relPath?: string }
  | { type: 'loadCommitDiff'; sha: string }
  | { type: 'runSearch'; query: string }
  | { type: 'runImpact'; symbol: string }
  | { type: 'jumpDefinition'; symbol: string; currentFile: string; currentLine: number };

export interface TuiState {
  rootLabel: string;
  tree: TreeNode[];
  treeCursor: number;
  treeScroll: number;
  focus: FocusPane;
  mode: ActiveMode;
  selectedFile: string | null;
  fileLines: string[];
  fileSymbols: SymbolInfo[];
  codeCursorLine: number;
  codeScroll: number;
  showBlame: boolean;
  blameByLine: Map<number, BlameLine>;
  searchQuery: string;
  searchResults: SearchResultItem[];
  searchCursor: number;
  commits: CommitItem[];
  commitCursor: number;
  diffLines: string[];
  diffScroll: number;
  diffSha: string | null;
  impactSymbol: string;
  impactItems: ImpactJumpItem[];
  impactCursor: number;
  statusMessage: string;
}

/** Parse raw stdin bytes into normalized key events. */
export function parseKeypress(chunk: Buffer | string): KeyEvent[] {
  const str = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
  const events: KeyEvent[] = [];
  let i = 0;

  while (i < str.length) {
    const ch = str[i];
    if (ch === '\x03') {
      events.push({ name: 'c', ctrl: true, sequence: ch });
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      events.push({ name: 'return', sequence: ch });
      i++;
      continue;
    }
    if (ch === '\t') {
      events.push({ name: 'tab', sequence: ch });
      i++;
      continue;
    }
    if (ch === '\x7f' || ch === '\b') {
      events.push({ name: 'backspace', sequence: ch });
      i++;
      continue;
    }
    if (ch === ' ') {
      events.push({ name: 'space', sequence: ch });
      i++;
      continue;
    }
    if (ch === '\x1b') {
      if (str.startsWith('\x1b[A', i)) {
        events.push({ name: 'up', sequence: '\x1b[A' });
        i += 3;
        continue;
      }
      if (str.startsWith('\x1b[B', i)) {
        events.push({ name: 'down', sequence: '\x1b[B' });
        i += 3;
        continue;
      }
      if (str.startsWith('\x1b[C', i)) {
        events.push({ name: 'right', sequence: '\x1b[C' });
        i += 3;
        continue;
      }
      if (str.startsWith('\x1b[D', i)) {
        events.push({ name: 'left', sequence: '\x1b[D' });
        i += 3;
        continue;
      }
      if (str.startsWith('\x1b[5~', i)) {
        events.push({ name: 'pageup', sequence: '\x1b[5~' });
        i += 4;
        continue;
      }
      if (str.startsWith('\x1b[6~', i)) {
        events.push({ name: 'pagedown', sequence: '\x1b[6~' });
        i += 4;
        continue;
      }
      events.push({ name: 'escape', sequence: '\x1b' });
      i++;
      continue;
    }

    events.push({ name: ch, sequence: ch });
    i++;
  }

  return events;
}

/** Build a dirs-first collapsible file tree from flat file entries. */
export function buildFileTree(files: TreeFileEntry[]): TreeNode[] {
  const rootNodes: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  const getOrCreateDir = (parts: string[]): TreeNode[] => {
    let currentList = rootNodes;
    let accum = '';
    for (let d = 0; d < parts.length; d++) {
      const part = parts[d];
      accum = accum ? `${accum}/${part}` : part;
      let dir = dirMap.get(accum);
      if (!dir) {
        dir = {
          id: `dir:${accum}`,
          name: part,
          relPath: accum,
          isDir: true,
          depth: d,
          expanded: true,
          symbolCount: 0,
          isHub: false,
          children: [],
        };
        dirMap.set(accum, dir);
        currentList.push(dir);
      }
      currentList = dir.children;
    }
    return currentList;
  };

  for (const f of files) {
    const norm = f.relPath.replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const fileName = parts[parts.length - 1];
    const dirParts = parts.slice(0, -1);
    const parentList = getOrCreateDir(dirParts);

    parentList.push({
      id: `file:${norm}`,
      name: fileName,
      relPath: norm,
      isDir: false,
      depth: dirParts.length,
      expanded: false,
      symbolCount: f.symbolCount,
      isHub: f.isHub,
      children: [],
    });
  }

  const sortAndRollup = (nodes: TreeNode[]): { symbols: number; hasHub: boolean } => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    let symbols = 0;
    let hasHub = false;
    for (const node of nodes) {
      if (node.isDir) {
        const sub = sortAndRollup(node.children);
        node.symbolCount = sub.symbols;
        node.isHub = sub.hasHub;
      }
      symbols += node.symbolCount;
      if (node.isHub) hasHub = true;
    }
    return { symbols, hasHub };
  };

  sortAndRollup(rootNodes);
  return rootNodes;
}

/** Flatten expanded tree nodes in display order. */
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.isDir && n.expanded) {
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return out;
}

function toggleDirInTree(nodes: TreeNode[], targetId: string, expanded?: boolean): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === targetId && n.isDir) {
      return { ...n, expanded: expanded !== undefined ? expanded : !n.expanded };
    }
    if (n.children.length > 0) {
      return { ...n, children: toggleDirInTree(n.children, targetId, expanded) };
    }
    return n;
  });
}

export function createInitialState(files: TreeFileEntry[], rootLabel: string): TuiState {
  const tree = buildFileTree(files);
  const flat = flattenTree(tree);
  const firstFile = flat.find((n) => !n.isDir)?.relPath ?? null;

  return {
    rootLabel,
    tree,
    treeCursor: 0,
    treeScroll: 0,
    focus: 'tree',
    mode: 'browse',
    selectedFile: firstFile,
    fileLines: [],
    fileSymbols: [],
    codeCursorLine: 1,
    codeScroll: 0,
    showBlame: false,
    blameByLine: new Map(),
    searchQuery: '',
    searchResults: [],
    searchCursor: 0,
    commits: [],
    commitCursor: 0,
    diffLines: [],
    diffScroll: 0,
    diffSha: null,
    impactSymbol: '',
    impactItems: [],
    impactCursor: 0,
    statusMessage: 'Ready',
  };
}

/** Pick the symbol at or nearest above `codeCursorLine`, else first symbol, else file basename. */
export function activeSymbolForState(state: TuiState): string {
  if (state.fileSymbols.length > 0) {
    let best = state.fileSymbols[0];
    for (const sym of state.fileSymbols) {
      const end = sym.endLine ?? sym.line;
      if (state.codeCursorLine >= sym.line && state.codeCursorLine <= end) {
        return sym.name;
      }
      if (sym.line <= state.codeCursorLine && sym.line >= best.line) {
        best = sym;
      }
    }
    return best.name;
  }
  if (state.selectedFile) {
    const base = state.selectedFile.split('/').pop() ?? state.selectedFile;
    return base.replace(/\.[^.]+$/, '');
  }
  return '';
}

function clamp(val: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(max, val));
}

function adjustScroll(cursor: number, scroll: number, visibleRows: number): number {
  if (visibleRows <= 0) return 0;
  if (cursor < scroll) return cursor;
  if (cursor >= scroll + visibleRows) return cursor - visibleRows + 1;
  return scroll;
}

export function handleKey(
  state: TuiState,
  key: KeyEvent,
  viewport: Viewport
): { state: TuiState; effect: TuiAction } {
  if (key.ctrl && key.name === 'c') {
    return { state, effect: { type: 'quit' } };
  }

  const bodyHeight = Math.max(4, viewport.rows - 2);

  // Search overlay mode
  if (state.mode === 'search') {
    if (key.name === 'escape') {
      return { state: { ...state, mode: 'browse' }, effect: { type: 'none' } };
    }
    if (key.name === 'up') {
      const nextCursor = clamp(state.searchCursor - 1, 0, Math.max(0, state.searchResults.length - 1));
      return { state: { ...state, searchCursor: nextCursor }, effect: { type: 'none' } };
    }
    if (key.name === 'down') {
      const nextCursor = clamp(state.searchCursor + 1, 0, Math.max(0, state.searchResults.length - 1));
      return { state: { ...state, searchCursor: nextCursor }, effect: { type: 'none' } };
    }
    if (key.name === 'return') {
      const hit = state.searchResults[state.searchCursor];
      if (!hit) {
        return { state: { ...state, mode: 'browse' }, effect: { type: 'none' } };
      }
      return {
        state: {
          ...state,
          mode: 'browse',
          focus: 'code',
          selectedFile: hit.relPath,
          codeCursorLine: hit.line,
        },
        effect: { type: 'loadFile', relPath: hit.relPath, targetLine: hit.line },
      };
    }
    if (key.name === 'backspace') {
      const nextQuery = state.searchQuery.slice(0, -1);
      return {
        state: { ...state, searchQuery: nextQuery, searchCursor: 0 },
        effect: { type: 'runSearch', query: nextQuery },
      };
    }
    const ch = key.sequence ?? (key.name.length === 1 ? key.name : '');
    if (ch.length === 1 && !key.ctrl && !key.meta && ch >= ' ') {
      const nextQuery = state.searchQuery + ch;
      return {
        state: { ...state, searchQuery: nextQuery, searchCursor: 0 },
        effect: { type: 'runSearch', query: nextQuery },
      };
    }
    return { state, effect: { type: 'none' } };
  }

  // History mode
  if (state.mode === 'history') {
    if (key.name === 'q') return { state, effect: { type: 'quit' } };
    if (key.name === 'escape' || key.name === 'h') {
      return { state: { ...state, mode: 'browse' }, effect: { type: 'none' } };
    }
    if (key.name === 'up' || key.name === 'k') {
      const nextCursor = clamp(state.commitCursor - 1, 0, Math.max(0, state.commits.length - 1));
      return { state: { ...state, commitCursor: nextCursor }, effect: { type: 'none' } };
    }
    if (key.name === 'down' || key.name === 'j') {
      const nextCursor = clamp(state.commitCursor + 1, 0, Math.max(0, state.commits.length - 1));
      return { state: { ...state, commitCursor: nextCursor }, effect: { type: 'none' } };
    }
    if (key.name === 'return') {
      const commit = state.commits[state.commitCursor];
      if (!commit) return { state, effect: { type: 'none' } };
      return {
        state: { ...state, mode: 'diff', diffSha: commit.sha, diffScroll: 0 },
        effect: { type: 'loadCommitDiff', sha: commit.sha },
      };
    }
    return { state, effect: { type: 'none' } };
  }

  // Diff mode
  if (state.mode === 'diff') {
    if (key.name === 'q') return { state, effect: { type: 'quit' } };
    if (key.name === 'escape') {
      return { state: { ...state, mode: 'history' }, effect: { type: 'none' } };
    }
    if (key.name === 'up' || key.name === 'k') {
      return {
        state: { ...state, diffScroll: Math.max(0, state.diffScroll - 1) },
        effect: { type: 'none' },
      };
    }
    if (key.name === 'down' || key.name === 'j') {
      const maxScroll = Math.max(0, state.diffLines.length - bodyHeight);
      return {
        state: { ...state, diffScroll: Math.min(maxScroll, state.diffScroll + 1) },
        effect: { type: 'none' },
      };
    }
    return { state, effect: { type: 'none' } };
  }

  // Global keys in browse / impact mode
  if (key.name === 'q') {
    return { state, effect: { type: 'quit' } };
  }
  if (key.name === '/') {
    return {
      state: { ...state, mode: 'search', searchQuery: '', searchResults: [], searchCursor: 0 },
      effect: { type: 'none' },
    };
  }
  if (key.name === 'b') {
    const nextBlame = !state.showBlame;
    if (nextBlame && state.selectedFile) {
      return {
        state: { ...state, showBlame: true },
        effect: { type: 'loadBlame', relPath: state.selectedFile },
      };
    }
    return { state: { ...state, showBlame: nextBlame }, effect: { type: 'none' } };
  }
  if (key.name === 'h') {
    return {
      state: { ...state, mode: 'history', commitCursor: 0 },
      effect: { type: 'loadHistory', relPath: state.selectedFile ?? undefined },
    };
  }
  if (key.name === 'r') {
    const sym = activeSymbolForState(state);
    if (!sym) return { state, effect: { type: 'none' } };
    return {
      state: { ...state, mode: 'impact', focus: 'drawer', impactSymbol: sym, impactCursor: 0 },
      effect: { type: 'runImpact', symbol: sym },
    };
  }
  if (key.name === 'd') {
    const sym = activeSymbolForState(state);
    if (!sym || !state.selectedFile) return { state, effect: { type: 'none' } };
    return {
      state,
      effect: {
        type: 'jumpDefinition',
        symbol: sym,
        currentFile: state.selectedFile,
        currentLine: state.codeCursorLine,
      },
    };
  }
  if (key.name === 'escape' && state.mode === 'impact') {
    return {
      state: { ...state, mode: 'browse', focus: 'code' },
      effect: { type: 'none' },
    };
  }
  if (key.name === 'tab') {
    const order: FocusPane[] =
      state.mode === 'impact' && state.impactItems.length > 0
        ? ['tree', 'code', 'drawer']
        : ['tree', 'code'];
    const idx = order.indexOf(state.focus);
    const nextFocus = order[(idx + 1) % order.length];
    return { state: { ...state, focus: nextFocus }, effect: { type: 'none' } };
  }

  // Pane-specific navigation
  if (state.focus === 'tree') {
    const flat = flattenTree(state.tree);
    if (key.name === 'up' || key.name === 'k') {
      const nextCursor = clamp(state.treeCursor - 1, 0, Math.max(0, flat.length - 1));
      const nextScroll = adjustScroll(nextCursor, state.treeScroll, bodyHeight);
      return {
        state: { ...state, treeCursor: nextCursor, treeScroll: nextScroll },
        effect: { type: 'none' },
      };
    }
    if (key.name === 'down' || key.name === 'j') {
      const nextCursor = clamp(state.treeCursor + 1, 0, Math.max(0, flat.length - 1));
      const nextScroll = adjustScroll(nextCursor, state.treeScroll, bodyHeight);
      return {
        state: { ...state, treeCursor: nextCursor, treeScroll: nextScroll },
        effect: { type: 'none' },
      };
    }
    if (key.name === 'left') {
      const cur = flat[state.treeCursor];
      if (cur?.isDir && cur.expanded) {
        return {
          state: { ...state, tree: toggleDirInTree(state.tree, cur.id, false) },
          effect: { type: 'none' },
        };
      }
      return { state, effect: { type: 'none' } };
    }
    if (key.name === 'return' || key.name === 'space' || key.name === 'right') {
      const cur = flat[state.treeCursor];
      if (!cur) return { state, effect: { type: 'none' } };
      if (cur.isDir) {
        const nextExpanded = key.name === 'right' ? true : !cur.expanded;
        return {
          state: { ...state, tree: toggleDirInTree(state.tree, cur.id, nextExpanded) },
          effect: { type: 'none' },
        };
      }
      return {
        state: { ...state, selectedFile: cur.relPath, codeCursorLine: 1, codeScroll: 0 },
        effect: { type: 'loadFile', relPath: cur.relPath },
      };
    }
    return { state, effect: { type: 'none' } };
  }

  if (state.focus === 'drawer' && state.mode === 'impact') {
    if (key.name === 'up' || key.name === 'k') {
      const nextCursor = clamp(state.impactCursor - 1, 0, Math.max(0, state.impactItems.length - 1));
      return { state: { ...state, impactCursor: nextCursor }, effect: { type: 'none' } };
    }
    if (key.name === 'down' || key.name === 'j') {
      const nextCursor = clamp(state.impactCursor + 1, 0, Math.max(0, state.impactItems.length - 1));
      return { state: { ...state, impactCursor: nextCursor }, effect: { type: 'none' } };
    }
    if (key.name === 'return') {
      const item = state.impactItems[state.impactCursor];
      if (!item || !item.file) return { state, effect: { type: 'none' } };
      const targetLine = item.callSiteLine ?? item.line;
      return {
        state: {
          ...state,
          selectedFile: item.file,
          codeCursorLine: targetLine,
          focus: 'code',
        },
        effect: { type: 'loadFile', relPath: item.file, targetLine },
      };
    }
    return { state, effect: { type: 'none' } };
  }

  // Code pane navigation
  if (key.name === 'up' || key.name === 'k') {
    const nextLine = Math.max(1, state.codeCursorLine - 1);
    const nextScroll = adjustScroll(nextLine - 1, state.codeScroll, Math.max(1, bodyHeight - 2));
    return {
      state: { ...state, codeCursorLine: nextLine, codeScroll: nextScroll },
      effect: { type: 'none' },
    };
  }
  if (key.name === 'down' || key.name === 'j') {
    const maxLine = Math.max(1, state.fileLines.length);
    const nextLine = Math.min(maxLine, state.codeCursorLine + 1);
    const nextScroll = adjustScroll(nextLine - 1, state.codeScroll, Math.max(1, bodyHeight - 2));
    return {
      state: { ...state, codeCursorLine: nextLine, codeScroll: nextScroll },
      effect: { type: 'none' },
    };
  }

  return { state, effect: { type: 'none' } };
}

function fitPlain(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length === width) return text;
  if (text.length > width) {
    return width > 1 ? text.slice(0, width - 1) + '…' : text.slice(0, width);
  }
  return text + ' '.repeat(width - text.length);
}

function padStyled(styledText: string, width: number): string {
  const plainLen = stripAnsi(styledText).length;
  if (plainLen === width) return styledText;
  if (plainLen < width) return styledText + ' '.repeat(width - plainLen);
  return fitPlain(stripAnsi(styledText), width);
}

/** Render the full TUI frame as an ANSI string for the given viewport. */
export function renderFrame(state: TuiState, viewport: Viewport, customStyles?: Styles): string {
  const cols = Math.max(40, viewport.cols);
  const rows = Math.max(10, viewport.rows);
  const st = customStyles ?? createStyles({ isTTY: true } as unknown as NodeJS.WritableStream);
  const kit = kitTui();
  const theme = getTheme();

  const leftWidth = Math.max(20, Math.floor(cols * 0.3));
  const rightWidth = Math.max(18, cols - leftWidth - 1);
  const bodyHeight = Math.max(4, rows - 2);

  // Header
  const modeBadge = kit
    ? kit.badge(theme, state.mode.toUpperCase())
    : st.accent(`[${state.mode.toUpperCase()}]`);
  const fileInfo = state.selectedFile ? `${state.selectedFile}:${state.codeCursorLine}` : '(no file)';
  const headerLeft = `${st.bold(`xray ${state.rootLabel}`)}  ${modeBadge}  ${st.muted(fileInfo)}`;
  const headerLine = padStyled(headerLeft, cols);

  // Left pane lines (file tree)
  const flatTree = flattenTree(state.tree);
  const leftRows: string[] = [];
  for (let i = 0; i < bodyHeight; i++) {
    const idx = state.treeScroll + i;
    const node = flatTree[idx];
    if (!node) {
      leftRows.push(' '.repeat(leftWidth));
      continue;
    }
    const indent = '  '.repeat(node.depth);
    const icon = node.isDir ? (node.expanded ? '▾ ' : '▸ ') : '  ';
    const label = node.isDir ? `${node.name}/` : node.name;
    const count = node.symbolCount > 0 ? ` (${node.symbolCount})` : '';
    const star = node.isHub ? ' ★' : '';
    const raw = `${indent}${icon}${label}${count}${star}`;
    const fitted = fitPlain(raw, leftWidth);
    if (idx === state.treeCursor) {
      leftRows.push(st.accent(fitted));
    } else if (node.isHub) {
      leftRows.push(st.warn(fitted));
    } else if (node.isDir) {
      leftRows.push(st.bold(fitted));
    } else {
      leftRows.push(fitted);
    }
  }

  // Right pane lines
  const rightRows: string[] = [];

  if (state.mode === 'history') {
    rightRows.push(padStyled(st.bold('Commit History (Enter: diff, Esc: back)'), rightWidth));
    for (let i = 1; i < bodyHeight; i++) {
      const c = state.commits[i - 1];
      if (!c) {
        rightRows.push(' '.repeat(rightWidth));
        continue;
      }
      const dateStr = c.authorDate.slice(0, 10);
      const raw = `${c.shortSha} ${dateStr} ${c.authorName}: ${c.subject}`;
      const fitted = fitPlain(raw, rightWidth);
      rightRows.push(i - 1 === state.commitCursor ? st.accent(fitted) : fitted);
    }
  } else if (state.mode === 'diff') {
    rightRows.push(padStyled(st.bold(`Commit Diff ${state.diffSha ?? ''} (Esc: back)`), rightWidth));
    for (let i = 1; i < bodyHeight; i++) {
      const line = state.diffLines[state.diffScroll + i - 1];
      if (line === undefined) {
        rightRows.push(' '.repeat(rightWidth));
        continue;
      }
      const fitted = fitPlain(line, rightWidth);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        rightRows.push(st.success(fitted));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        rightRows.push(st.error(fitted));
      } else if (line.startsWith('@@')) {
        rightRows.push(st.accent(fitted));
      } else {
        rightRows.push(fitted);
      }
    }
  } else {
    // Code + Symbol outline (+ optional bottom impact drawer)
    const drawerHeight =
      state.mode === 'impact' ? Math.min(10, Math.max(5, Math.floor(bodyHeight * 0.35))) : 0;
    const codeAreaHeight = Math.max(2, bodyHeight - drawerHeight);

    const outlineItems = state.fileSymbols
      .slice(0, 6)
      .map((s) => `${s.kind}:${s.name}@L${s.line}`)
      .join(' · ');
    const outlineText = outlineItems ? `Symbols: ${outlineItems}` : 'Symbols: (none)';
    rightRows.push(padStyled(st.muted(fitPlain(outlineText, rightWidth)), rightWidth));

    const codeLinesAvail = codeAreaHeight - 1;
    for (let i = 0; i < codeLinesAvail; i++) {
      const lineIdx = state.codeScroll + i;
      const lineNo = lineIdx + 1;
      const src = state.fileLines[lineIdx];
      if (src === undefined) {
        rightRows.push(' '.repeat(rightWidth));
        continue;
      }
      let blameCol = '';
      if (state.showBlame) {
        const b = state.blameByLine.get(lineNo);
        const sha = b ? b.sha.slice(0, 7) : '-------';
        const author = fitPlain(b?.author ?? '', 10);
        blameCol = `${sha} ${author} `;
      }
      const numCol = String(lineNo).padStart(4, ' ') + ' │ ';
      const text = `${blameCol}${numCol}${src}`;
      const fitted = fitPlain(text, rightWidth);
      if (lineNo === state.codeCursorLine) {
        rightRows.push(st.accent(fitted));
      } else {
        rightRows.push(fitted);
      }
    }

    if (drawerHeight > 0) {
      const drawerHeader = `Impact: ${state.impactSymbol} (${state.impactItems.length} callers) [Enter: jump]`;
      rightRows.push(padStyled(st.warn(fitPlain(drawerHeader, rightWidth)), rightWidth));
      for (let i = 1; i < drawerHeight; i++) {
        const item = state.impactItems[i - 1];
        if (!item) {
          rightRows.push(' '.repeat(rightWidth));
          continue;
        }
        const site = item.callSiteLine ?? item.line;
        const raw = `d${item.depth} ${item.callerName} (${item.file}:L${site}) [${item.confidence.toLowerCase()}]`;
        const fitted = fitPlain(raw, rightWidth);
        rightRows.push(i - 1 === state.impactCursor ? st.accent(fitted) : fitted);
      }
    }
  }

  // Search overlay replaces top of right pane when active
  if (state.mode === 'search') {
    const overlayLines: string[] = [];
    overlayLines.push(padStyled(st.bold(fitPlain(`Search: ${state.searchQuery}_`, rightWidth)), rightWidth));
    const maxHits = Math.min(bodyHeight - 1, Math.max(5, state.searchResults.length));
    for (let i = 0; i < maxHits; i++) {
      const hit = state.searchResults[i];
      if (!hit) {
        overlayLines.push(padStyled(st.muted(fitPlain(i === 0 ? '  (type to search)' : '', rightWidth)), rightWidth));
        continue;
      }
      const raw = `  ${hit.relPath}:${hit.line}  ${hit.content}`;
      const fitted = fitPlain(raw, rightWidth);
      overlayLines.push(i === state.searchCursor ? st.accent(fitted) : fitted);
    }
    for (let i = 0; i < overlayLines.length && i < rightRows.length; i++) {
      rightRows[i] = overlayLines[i];
    }
  }

  // Combine panes
  const divider = st.muted('│');
  const bodyLines: string[] = [];
  for (let i = 0; i < bodyHeight; i++) {
    const l = leftRows[i] ?? ' '.repeat(leftWidth);
    const r = rightRows[i] ?? ' '.repeat(rightWidth);
    bodyLines.push(`${l}${divider}${r}`);
  }

  const footerText = `/:search  b:blame  h:history  d:def  r:impact  Tab:pane  q:quit  | ${state.statusMessage}`;
  const footerLine = padStyled(st.muted(fitPlain(footerText, cols)), cols);

  return `\x1b[2J\x1b[H${headerLine}\n${bodyLines.join('\n')}\n${footerLine}`;
}
