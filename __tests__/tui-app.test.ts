import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { PassThrough } from 'stream';
import { Command } from 'commander';
import {
  buildFileTree,
  createInitialState,
  ENTER_ALT_SCREEN,
  EXIT_ALT_SCREEN,
  flattenTree,
  handleKey,
  parseKeypress,
  renderFrame,
  type TreeFileEntry,
} from '../src/lib/tui/screen';
import { runTuiApp } from '../src/lib/tui/app';
import { registerTuiCommand } from '../src/commands/tui';
import { registerCoreCommands } from '../src/commands/registration/core';
import { declaredEffect } from '../src/commands/side-effect';
import { UsageError } from '../src/lib/error/types';

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-tui-test-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'math.ts'),
    [
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
      '',
      'export function doubleAdd(x: number): number {',
      '  return add(x, x);',
      '}',
    ].join('\n'),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(dir, 'src', 'main.ts'),
    [
      "import { add, doubleAdd } from './math';",
      '',
      'export function run(): number {',
      '  const first = add(1, 2);',
      '  return first + doubleAdd(3);',
      '}',
    ].join('\n'),
    'utf-8'
  );

  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

class VirtualTtyInput extends PassThrough {
  isTTY = true;
  rawMode = false;
  setRawMode(mode: boolean): this {
    this.rawMode = mode;
    return this;
  }
}

class VirtualTtyOutput extends PassThrough {
  isTTY = true;
  columns = 120;
  rows = 36;
  chunks: string[] = [];

  override write(chunk: string | Uint8Array, ...args: any[]): boolean {
    const str = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    this.chunks.push(str);
    return super.write(chunk, ...args);
  }

  fullOutput(): string {
    return this.chunks.join('');
  }

  plainText(): string {
    return stripAnsi(this.fullOutput());
  }
}

describe('TUI screen state & renderer', () => {
  const files: TreeFileEntry[] = [
    { relPath: 'z-root.ts', symbolCount: 1, isHub: false, rank: 0.05 },
    { relPath: 'src/b.ts', symbolCount: 2, isHub: false, rank: 0.1 },
    { relPath: 'src/a.ts', symbolCount: 4, isHub: true, rank: 0.8 },
  ];

  test('builds dirs-first collapsible tree with symbol counts and PageRank star on hubs', () => {
    const tree = buildFileTree(files);
    expect(tree.map((n) => n.name)).toEqual(['src', 'z-root.ts']);
    const flat = flattenTree(tree);
    expect(flat.map((n) => n.relPath)).toEqual(['src', 'src/a.ts', 'src/b.ts', 'z-root.ts']);

    const state = createInitialState(files, 'repo');
    const frame = stripAnsi(renderFrame(state, { cols: 100, rows: 24 }));
    expect(frame).toContain('src/');
    expect(frame).toContain('a.ts');
    expect(frame).toContain('★');
    expect(frame).toContain('(4)');
  });

  test('tree navigation collapses directory and moves cursor', () => {
    let state = createInitialState(files, 'repo');
    // Cursor starts at index 0 ('src')
    const collapsed = handleKey(state, { name: 'return' }, { cols: 100, rows: 24 });
    state = collapsed.state;
    const flatAfterCollapse = flattenTree(state.tree);
    expect(flatAfterCollapse.map((n) => n.relPath)).toEqual(['src', 'z-root.ts']);

    // Move down to z-root.ts and open it
    const down = handleKey(state, { name: 'down' }, { cols: 100, rows: 24 });
    state = down.state;
    const openFile = handleKey(state, { name: 'return' }, { cols: 100, rows: 24 });
    expect(openFile.effect).toEqual({ type: 'loadFile', relPath: 'z-root.ts' });
  });

  test('parseKeypress handles arrows, ctrl+c, escape, and printable keys', () => {
    expect(parseKeypress(Buffer.from('\x1b[A'))[0]).toMatchObject({ name: 'up' });
    expect(parseKeypress(Buffer.from('\x1b[B'))[0]).toMatchObject({ name: 'down' });
    expect(parseKeypress(Buffer.from('\x03'))[0]).toMatchObject({ name: 'c', ctrl: true });
    expect(parseKeypress(Buffer.from('q'))[0]).toMatchObject({ name: 'q' });
    expect(parseKeypress(Buffer.from('/'))[0]).toMatchObject({ name: '/' });
  });
});

describe('TUI app headless keypress-stream integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempProject();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function waitForOutput(out: VirtualTtyOutput, pattern: string | RegExp, timeoutMs = 4000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const text = out.plainText();
      if (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)) {
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out waiting for ${pattern}. Last output:\n${out.plainText().slice(-800)}`);
  }

  test('supports tree navigation, / search jump, r impact drawer, b blame, h history+diff, and clean q exit', async () => {
    const stdin = new VirtualTtyInput();
    const stdout = new VirtualTtyOutput();

    const appPromise = runTuiApp(tmpDir, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      cols: 120,
      rows: 36,
    });

    // Wait for initial render with project files
    await waitForOutput(stdout, 'math.ts');
    expect(stdin.rawMode).toBe(true);
    expect(stdout.fullOutput()).toContain(ENTER_ALT_SCREEN);

    // 1. Open search overlay with '/', search for 'doubleAdd', press Enter to jump
    stdin.write('/');
    await waitForOutput(stdout, 'Search:');
    stdin.write('doubleAdd');
    await waitForOutput(stdout, 'src/math.ts:5');
    stdin.write('\r');
    await waitForOutput(stdout, 'export function doubleAdd');

    // 2. Toggle blame gutter with 'b'
    stdin.write('b');
    await waitForOutput(stdout, 'Test User');

    // 3. Open impact drawer with 'r' for current symbol or 'add'
    // First jump to definition or select 'add' via search, or run impact on current symbol
    stdin.write('/');
    await waitForOutput(stdout, 'Search:');
    stdin.write('function add');
    await waitForOutput(stdout, 'src/math.ts:1');
    stdin.write('\r');
    await waitForOutput(stdout, 'export function add');

    stdin.write('r');
    await waitForOutput(stdout, 'Impact:');
    await waitForOutput(stdout, 'doubleAdd');
    await waitForOutput(stdout, /L6\b/);

    // Jump to call site with Enter (first caller in impact drawer is run at src/main.ts:L4)
    stdin.write('\r');
    await waitForOutput(stdout, 'const first = add(1, 2);');

    // 3b. Jump to symbol definition with 'd' (from `const first = add(1, 2);` -> `add`)
    stdin.write('d');
    await waitForOutput(stdout, 'Definition: add');

    // 4. Open commit history with 'h' and view diff with Enter
    stdin.write('h');
    await waitForOutput(stdout, 'initial commit');
    stdin.write('\r');
    await waitForOutput(stdout, 'diff --git');

    // 5. Quit cleanly with 'q'
    stdin.write('q');
    await appPromise;

    expect(stdin.rawMode).toBe(false);
    const full = stdout.fullOutput();
    expect(full).toContain(EXIT_ALT_SCREEN);
    expect(full).toContain('\x1b[?1049l');
    expect(full).toContain('\x1b[?25h');
  }, 15000);

  test('exits cleanly on Ctrl+C', async () => {
    const stdin = new VirtualTtyInput();
    const stdout = new VirtualTtyOutput();

    const appPromise = runTuiApp(tmpDir, {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      cols: 100,
      rows: 30,
    });

    await waitForOutput(stdout, 'math.ts');
    stdin.write('\x03');
    await appPromise;

    expect(stdin.rawMode).toBe(false);
    expect(stdout.fullOutput()).toContain(EXIT_ALT_SCREEN);
  }, 10000);

  test('throws UsageError when stdout is not a TTY and registers as interactive in core', async () => {
    const program = new Command();
    registerCoreCommands(program);
    const tuiCmd = program.commands.find((c) => c.name() === 'tui');
    expect(tuiCmd).toBeDefined();
    expect(declaredEffect(tuiCmd!)).toEqual({ tier: 'interactive', idempotent: 'no' });

    const standalone = new Command();
    registerTuiCommand(standalone);

    const origIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    try {
      await expect(standalone.parseAsync(['node', 'xray', 'tui', tmpDir])).rejects.toThrow(UsageError);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: origIsTTY, configurable: true });
    }
  });
});
