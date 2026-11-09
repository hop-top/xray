/**
 * Shipped harness hook scripts (hooks/harness/): the core
 * `xray-impact-context`, the symbol filter, and the Claude Code, nerv
 * and Gemini adapters. Each script runs for real against the built
 * bin/xray and a fixture graph (XRAY_GRAPH), with TMPDIR, HOME and
 * XDG_STATE_HOME isolated so per-session state never touches the machine.
 *
 * Trust model: the core reads a graph only if save-graph.sh wrote it, i.e.
 * the graph is untracked, not a symlink, inside the cwd's git work tree,
 * and its sha256 matches the per-user sidecar. Fixtures go through
 * trust() below, which writes the sidecar save-graph.sh would write.
 *
 * Hook rules pinned here: stdout is exact JSON or nothing, exit is
 * always 0, a symbol is announced once per session, and anything that
 * is not a plain identifier search stays silent.
 */
import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { SerializedGraph, SerializedNode, SerializedEdge } from '../../src/lib/query/types';

const REPO = path.resolve(__dirname, '../..');
const HOOKS = path.join(REPO, 'hooks', 'harness');
const BIN_DIR = path.join(REPO, 'bin');
const CORE = path.join(HOOKS, 'xray-impact-context');
const EXTRACT = path.join(HOOKS, 'lib', 'extract-symbol.sh');
const SAVE = path.join(HOOKS, 'lib', 'save-graph.sh');
const TRUST_LIB = path.join(HOOKS, 'lib', 'graph-trust.sh');
const CLAUDE_PRE = path.join(HOOKS, 'claude', 'pretooluse-impact.sh');
const CLAUDE_START = path.join(HOOKS, 'claude', 'session-start.sh');
const NERV = path.join(HOOKS, 'nerv', 'xray-impact.sh');
const NERV_TEST = path.join(HOOKS, 'nerv', 'test-xray-impact.sh');
const NERV_SAVE = path.join(HOOKS, 'nerv', 'xray-save-graph.sh');
const GEMINI_AFTER = path.join(HOOKS, 'gemini', 'after-tool-impact.sh');
const GEMINI_START = path.join(HOOKS, 'gemini', 'session-start.sh');

const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const missing = ['jq', 'bash'].filter(c => !has(c));
const skipNote = missing.length ? ` [skipped: ${missing.join(', ')} not installed]` : '';
const d = missing.length ? describe.skip : describe;

function tag(file: string, name: string, line: number, kind = 'function'): SerializedNode {
  return { id: `${file}::${name}`, type: 'tag', label: name, kind, file, line };
}

function calls(from: SerializedNode, to: SerializedNode): SerializedEdge {
  return { source: from.id, target: to.id, type: 'calls', confidence: 'EXTRACTED' };
}

function graphOf(nodes: SerializedNode[], edges: SerializedEdge[]): SerializedGraph {
  return {
    metadata: {
      version: '1.0', timestamp: '2026-01-01T00:00:00.000Z', projectPath: '/p',
      nodeCount: nodes.length, edgeCount: edges.length,
    },
    nodes,
    edges,
  };
}

// RunHooks <- Dispatch, RunHooks <- Replay; Lonely has no callers.
const RUN = tag('internal/dispatch/run.go', 'RunHooks', 108, 'method');
const DISPATCH = tag('internal/dispatch/dispatch.go', 'Dispatch', 85);
const REPLAY = tag('cmd/replay.go', 'Replay', 12);
const LONELY = tag('internal/dispatch/run.go', 'Lonely', 200);
const FIXTURE = graphOf([RUN, DISPATCH, REPLAY, LONELY], [calls(DISPATCH, RUN), calls(REPLAY, RUN)]);

const MARKER = /^\[xray impact\] RunHooks \(graph saved \d+m ago\)\n/;

let tmp: string;
let graph: string;
let state: string;
let xdg: string;

const sha256 = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp } });
  expect(r.status).toBe(0);
  return r.stdout;
};
/** Physical dir + basename: the path the hooks key the sidecar on. */
const keyOf = (file: string) => path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
const sidecarOf = (file: string) => path.join(xdg, 'xray', 'hooks', sha256(keyOf(file)));
/** Record `file` as self-written (what save-graph.sh does after a save). */
function trust(file: string, key = keyOf(file)): void {
  const side = path.join(xdg, 'xray', 'hooks', sha256(key));
  fs.mkdirSync(path.dirname(side), { recursive: true });
  fs.writeFileSync(side, `${sha256(fs.readFileSync(file))}\n`);
}
/** Fresh dir outside the test repo. */
const outsideDirs: string[] = [];
function outside(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hooks-out-'));
  outsideDirs.push(dir);
  return dir;
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH ?? ''}`,
    HOME: tmp,
    TMPDIR: state,
    XDG_STATE_HOME: xdg,
    XRAY_GRAPH: graph,
    ...extra,
  };
}

function run(script: string, opts: { input?: string; args?: string[]; env?: NodeJS.ProcessEnv; cwd?: string } = {}): SpawnSyncReturns<string> {
  return spawnSync(script, opts.args ?? [], {
    input: opts.input ?? '',
    env: opts.env ?? env(),
    cwd: opts.cwd ?? tmp,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

const claudeEvent = (tool: string, input: Record<string, string>, session = 'sess-1') => JSON.stringify({
  session_id: session, transcript_path: '/dev/null', cwd: tmp,
  hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input,
});

const nervEvent = (event: string, tool: string, input: Record<string, string>, session = 'sess-1') => JSON.stringify({
  nerv_version: '1.0.0-draft', event, event_id: 'e-1', timestamp: '2026-11-01T00:00:00Z',
  cli: { name: 'claude-code', version: '2.1.0' },
  session: { id: session, cwd: tmp },
  payload: { tool_name: tool, tool_input: input, session_id: session },
});

const geminiEvent = (tool: string, input: Record<string, string>, session = 'sess-1') => JSON.stringify({
  session_id: session, transcript_path: '/dev/null', cwd: tmp, hook_event_name: 'AfterTool',
  timestamp: '2026-11-01T00:00:00Z', tool_name: tool, tool_input: input,
  tool_response: { llmContent: 'internal/dispatch/run.go:108: func RunHooks', returnDisplay: '1 match' },
});

beforeAll(() => {
  if (!fs.existsSync(path.join(REPO, 'dist', 'index.js'))) {
    throw new Error('dist/ missing: run `npm run build` before this suite');
  }
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-hooks-'));
  state = path.join(tmp, 'state');
  fs.mkdirSync(state);
  xdg = path.join(tmp, 'xdg');
  git(tmp, 'init', '-q');
  graph = path.join(tmp, 'graph.json');
  fs.writeFileSync(graph, JSON.stringify(FIXTURE));
  trust(graph);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const dir of outsideDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('shipped hook files', () => {
  test.each([CORE, EXTRACT, SAVE, CLAUDE_PRE, CLAUDE_START, NERV, NERV_TEST, NERV_SAVE, GEMINI_AFTER, GEMINI_START])(
    '%s exists and is executable', file => {
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).mode & 0o111).toBe(0o111);
    });

  test('lib/graph-trust.sh exists (sourced, not run)', () => {
    expect(fs.existsSync(TRUST_LIB)).toBe(true);
  });
});

d(`extract-symbol.sh${skipNote}`, () => {
  const sym = (kind: string, value: string) => {
    const r = run(EXTRACT, { args: [kind, value] });
    expect(r.status).toBe(0);
    return r.stdout;
  };

  test.each([
    ['pattern', 'RunHooks', 'RunHooks'],
    ['pattern', '_private_fn', '_private_fn'],
    ['pattern', 'Run.*Hooks', ''],
    ['pattern', '\\bRunHooks\\b', ''],
    ['pattern', 'func RunHooks', ''],
    ['pattern', 'src/foo.ts', ''],
    ['pattern', 'ab', ''],
    ['pattern', '9lives', ''],
    ['pattern', '', ''],
  ])('%s %j -> %j', (kind, value, want) => {
    expect(sym(kind, value)).toBe(want ? `${want}\n` : '');
  });

  test.each([
    ['grep -rn RunHooks .', 'RunHooks'],
    ['rg -n "RunHooks" internal/', 'RunHooks'],
    ["rg 'RunHooks'", 'RunHooks'],
    ['rg -e RunHooks', 'RunHooks'],
    ['grep -A 3 -B2 RunHooks run.go', 'RunHooks'],
    ['rg -t go --glob "*.go" RunHooks', 'RunHooks'],
    ['grep -rn --include=*.go RunHooks .', 'RunHooks'],
    ['grep -- RunHooks .', 'RunHooks'],
    ['cd internal && grep -rn RunHooks .', 'RunHooks'],
    ['cat run.go | grep RunHooks', 'RunHooks'],
    ['egrep -n RunHooks run.go', 'RunHooks'],
    ['grep -rn "Run.*Hooks" .', ''],
    ['grep -rn ./internal', ''],
    ['grep -rn', ''],
    ['ls -la', ''],
    ['echo RunHooks', ''],
    ['xray impact RunHooks | grep Dispatch', ''],
    ['  xray --quiet impact RunHooks', ''],
  ])('command %j -> %j', (value, want) => {
    expect(sym('command', value)).toBe(want ? `${want}\n` : '');
  });

  test('unknown kind is silent, exit 0', () => {
    expect(sym('bogus', 'RunHooks')).toBe('');
  });
});

d(`xray-impact-context (core)${skipNote}`, () => {
  test('known symbol: marker line, then the brief impact', () => {
    const r = run(CORE, { args: ['RunHooks'] });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(MARKER);
    expect(r.stdout).toContain('RunHooks (method, internal/dispatch/run.go:L109) — 2 callers across 2 groups');
    expect(r.stdout).toContain('edges: EXTRACTED 2 · INFERRED 0');
  });

  test('graph age in minutes from the file mtime', () => {
    const old = new Date(Date.now() - 42 * 60_000);
    fs.utimesSync(graph, old, old);
    expect(run(CORE, { args: ['RunHooks'] }).stdout.split('\n')[0]).toBe('[xray impact] RunHooks (graph saved 42m ago)');
  });

  test.each([
    ['no match', ['Nope'], {}],
    ['zero callers', ['Lonely'], {}],
    ['no symbol argument', [], {}],
  ])('%s: silent, exit 0', (_name, args, extra) => {
    const r = run(CORE, { args, env: env(extra) });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  test('missing graph: silent, exit 0', () => {
    const r = run(CORE, { args: ['RunHooks'], env: env({ XRAY_GRAPH: path.join(tmp, 'absent.json') }) });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  });

  test('default graph is .xray/graph.json under the cwd', () => {
    fs.mkdirSync(path.join(tmp, '.xray'));
    fs.copyFileSync(graph, path.join(tmp, '.xray', 'graph.json'));
    trust(path.join(tmp, '.xray', 'graph.json'));
    const e = env();
    delete e.XRAY_GRAPH;
    expect(run(CORE, { args: ['RunHooks'], env: e }).stdout).toMatch(MARKER);
    expect(run(CORE, { args: ['RunHooks'], env: e, cwd: state }).stdout).toBe('');
  });

  test('xray not on PATH: silent, exit 0', () => {
    const r = run(CORE, { args: ['RunHooks'], env: env({ PATH: '/usr/bin:/bin' }) });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  });

  (has('timeout') || has('gtimeout') ? test : test.skip)('5 s budget: a hung xray is cut off, silent, exit 0', () => {
    const fake = path.join(tmp, 'fakebin');
    fs.mkdirSync(fake);
    fs.writeFileSync(path.join(fake, 'xray'), '#!/bin/sh\nsleep 30\necho late\n', { mode: 0o755 });
    const t0 = Date.now();
    const r = run(CORE, { args: ['RunHooks'], env: env({ PATH: `${fake}${path.delimiter}${process.env.PATH ?? ''}` }) });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 20_000);

  test('corrupt graph: silent, exit 0', () => {
    fs.writeFileSync(graph, '{not json');
    trust(graph);
    const r = run(CORE, { args: ['RunHooks'] });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  });

  test('once per symbol per session (XRAY_HOOK_SESSION); no session id = no dedupe', () => {
    const s1 = env({ XRAY_HOOK_SESSION: 'abc' });
    expect(run(CORE, { args: ['RunHooks'], env: s1 }).stdout).toMatch(MARKER);
    expect(run(CORE, { args: ['RunHooks'], env: s1 }).stdout).toBe('');
    expect(fs.readFileSync(path.join(state, 'xray-hook-abc'), 'utf8')).toBe('RunHooks\n');
    expect(run(CORE, { args: ['RunHooks'], env: env({ XRAY_HOOK_SESSION: 'other' }) }).stdout).toMatch(MARKER);
    expect(run(CORE, { args: ['RunHooks'] }).stdout).toMatch(MARKER);
    expect(run(CORE, { args: ['RunHooks'] }).stdout).toMatch(MARKER);
  });

  test('silent results are not recorded (a later, saved graph still reports)', () => {
    const later = path.join(tmp, 'later.json');
    const s1 = env({ XRAY_HOOK_SESSION: 'abc', XRAY_GRAPH: later });
    // no graph yet
    expect(run(CORE, { args: ['RunHooks'], env: s1 }).stdout).toBe('');
    // graph saved, but RunHooks has no callers in it yet
    fs.writeFileSync(later, JSON.stringify(graphOf([RUN, DISPATCH, REPLAY, LONELY], [])));
    trust(later);
    expect(run(CORE, { args: ['RunHooks'], env: s1 }).stdout).toBe('');
    expect(fs.existsSync(path.join(state, 'xray-hook-abc'))).toBe(false);
    fs.copyFileSync(graph, later);
    trust(later);
    expect(run(CORE, { args: ['RunHooks'], env: s1 }).stdout).toMatch(MARKER);
  });

  test('session id is sanitised into the state file name', () => {
    run(CORE, { args: ['RunHooks'], env: env({ XRAY_HOOK_SESSION: '../../x y' }) });
    expect(fs.readdirSync(state)).toEqual(['xray-hook-xy']);
  });
});

d(`claude/pretooluse-impact.sh${skipNote}`, () => {
  const parse = (r: SpawnSyncReturns<string>) => {
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    return JSON.parse(r.stdout);
  };

  test('Grep on an identifier: additionalContext, no permissionDecision', () => {
    const out = parse(run(CLAUDE_PRE, { input: claudeEvent('Grep', { pattern: 'RunHooks', path: '.' }) }));
    expect(Object.keys(out)).toEqual(['hookSpecificOutput']);
    expect(Object.keys(out.hookSpecificOutput).sort()).toEqual(['additionalContext', 'hookEventName']);
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.additionalContext).toMatch(MARKER);
    expect(out.hookSpecificOutput.additionalContext).toContain('2 callers across 2 groups');
  });

  test('Bash grep: same context; the repeat in the session is silent', () => {
    const ev = claudeEvent('Bash', { command: 'grep -rn RunHooks .' });
    expect(parse(run(CLAUDE_PRE, { input: ev })).hookSpecificOutput.additionalContext).toMatch(MARKER);
    const again = run(CLAUDE_PRE, { input: claudeEvent('Grep', { pattern: 'RunHooks' }) });
    expect([again.status, again.stdout, again.stderr]).toEqual([0, '', '']);
    expect(fs.existsSync(path.join(state, 'xray-hook-sess-1'))).toBe(true);
    expect(parse(run(CLAUDE_PRE, { input: claudeEvent('Grep', { pattern: 'RunHooks' }, 'sess-2') }))
      .hookSpecificOutput.additionalContext).toMatch(MARKER);
  });

  test('graph resolved against the event cwd', () => {
    fs.mkdirSync(path.join(tmp, '.xray'));
    fs.copyFileSync(graph, path.join(tmp, '.xray', 'graph.json'));
    trust(path.join(tmp, '.xray', 'graph.json'));
    const e = env();
    delete e.XRAY_GRAPH;
    const out = parse(run(CLAUDE_PRE, { input: claudeEvent('Grep', { pattern: 'RunHooks' }), env: e, cwd: state }));
    expect(out.hookSpecificOutput.additionalContext).toMatch(MARKER);
  });

  test.each([
    ['regex pattern', claudeEvent('Grep', { pattern: 'Run.*Hooks' })],
    ['path pattern', claudeEvent('Grep', { pattern: 'internal/dispatch' })],
    ['xray command', claudeEvent('Bash', { command: 'xray impact RunHooks | grep Dispatch' })],
    ['non-search command', claudeEvent('Bash', { command: 'ls -la' })],
    ['other tool', claudeEvent('Read', { file_path: 'RunHooks' })],
    ['no match', claudeEvent('Grep', { pattern: 'Nope' })],
    ['zero callers', claudeEvent('Grep', { pattern: 'Lonely' })],
    ['empty object', '{}'],
    ['not JSON', 'garbage'],
    ['empty stdin', ''],
  ])('%s: silent, exit 0', (_name, input) => {
    const r = run(CLAUDE_PRE, { input });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  });

  test('missing graph: silent, exit 0', () => {
    const r = run(CLAUDE_PRE, { input: claudeEvent('Grep', { pattern: 'RunHooks' }), env: env({ XRAY_GRAPH: path.join(tmp, 'absent.json') }) });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  });
});

d(`nerv/xray-impact.sh${skipNote}`, () => {
  const decision = (input: string) => {
    const r = run(NERV, { input });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    return JSON.parse(r.stdout);
  };

  test('lint probe {}: allow, no state written', () => {
    expect(decision('{}')).toEqual({ action: 'allow' });
    expect(fs.readdirSync(state)).toEqual([]);
  });

  test('PreToolUse Grep on an identifier: allow + context', () => {
    const out = decision(nervEvent('PreToolUse', 'Grep', { pattern: 'RunHooks' }));
    expect(Object.keys(out).sort()).toEqual(['action', 'context']);
    expect(out.action).toBe('allow');
    expect(out.context).toMatch(MARKER);
  });

  test('PreToolUse Bash grep, then the repeat is a bare allow', () => {
    expect(decision(nervEvent('PreToolUse', 'Bash', { command: 'rg -n RunHooks' })).context).toMatch(MARKER);
    expect(decision(nervEvent('PreToolUse', 'Grep', { pattern: 'RunHooks' }))).toEqual({ action: 'allow' });
    expect(fs.readdirSync(state)).toEqual(['xray-hook-sess-1']);
  });

  test.each([
    ['other event', nervEvent('PostToolUse', 'Grep', { pattern: 'RunHooks' })],
    ['regex pattern', nervEvent('PreToolUse', 'Grep', { pattern: 'Run.*' })],
    ['xray command', nervEvent('PreToolUse', 'Bash', { command: 'xray impact RunHooks' })],
    ['other tool', nervEvent('PreToolUse', 'Read', { file_path: 'x' })],
    ['not JSON', 'garbage'],
  ])('%s: bare allow', (_name, input) => {
    expect(decision(input)).toEqual({ action: 'allow' });
  });

  test('missing graph: bare allow', () => {
    const r = run(NERV, { input: nervEvent('PreToolUse', 'Grep', { pattern: 'RunHooks' }), env: env({ XRAY_GRAPH: path.join(tmp, 'absent.json') }) });
    expect([r.status, JSON.parse(r.stdout)]).toEqual([0, { action: 'allow' }]);
  });

  test('test-xray-impact.sh passes', () => {
    const r = run(NERV_TEST, { env: { PATH: env().PATH, HOME: tmp, TMPDIR: state } });
    expect(r.stdout).toContain('FAIL=0');
    expect(r.status).toBe(0);
  });
});

d(`gemini/after-tool-impact.sh${skipNote}`, () => {
  test.each([
    ['grep_search', { pattern: 'RunHooks' }],
    ['search_file_content', { pattern: 'RunHooks' }],
    ['run_shell_command', { command: 'grep -rn RunHooks .' }],
  ])('%s: AfterTool additionalContext', (tool, input) => {
    const r = run(GEMINI_AFTER, { input: geminiEvent(tool, input) });
    expect([r.status, r.stderr]).toEqual([0, '']);
    const out = JSON.parse(r.stdout);
    expect(out).toEqual({ hookSpecificOutput: { hookEventName: 'AfterTool', additionalContext: expect.stringMatching(MARKER) } });
  });

  test('repeat in the session is silent; stderr stays empty (Gemini reads stderr when stdout is empty)', () => {
    run(GEMINI_AFTER, { input: geminiEvent('grep_search', { pattern: 'RunHooks' }) });
    const r = run(GEMINI_AFTER, { input: geminiEvent('grep_search', { pattern: 'RunHooks' }) });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  });

  test.each([
    ['regex', geminiEvent('grep_search', { pattern: 'Run.*' })],
    ['other tool', geminiEvent('read_file', { file_path: 'RunHooks' })],
    ['xray command', geminiEvent('run_shell_command', { command: 'xray impact RunHooks' })],
    ['not JSON', 'garbage'],
  ])('%s: silent, exit 0', (_name, input) => {
    const r = run(GEMINI_AFTER, { input });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  });
});

d(`session start: background graph save${skipNote}`, () => {
  let project: string;

  beforeEach(() => {
    project = path.join(tmp, 'proj');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'go.mod'), 'module example.com/p\n\ngo 1.22\n');
    fs.writeFileSync(path.join(project, 'a.go'), 'package p\n\nfunc Foo() { Bar() }\n\nfunc Bar() {}\n');
    expect(spawnSync('git', ['init', '-q'], { cwd: project }).status).toBe(0);
  });

  async function waitFor(file: string, ms = 60_000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (fs.existsSync(file)) return true;
      await new Promise(res => setTimeout(res, 200));
    }
    return false;
  }

  const startEvent = (cwd: string) => JSON.stringify({ session_id: 's', cwd, hook_event_name: 'SessionStart', source: 'startup' });

  test('claude: returns before the save; one plain orientation line; graph lands at XRAY_GRAPH', async () => {
    const out = path.join(project, 'saved', 'graph.json');
    const r = run(CLAUDE_START, { input: startEvent(project), env: env({ XRAY_GRAPH: out }) });
    expect([r.status, r.stderr]).toEqual([0, '']);
    expect(r.stdout).toMatch(/^\[xray\] [^\n]+\n$/);
    expect(r.stdout).toContain(out);
    expect(await waitFor(out)).toBe(true);
    expect(await waitFor(sidecarOf(out))).toBe(true);
    const saved = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(saved.nodes.some((n: SerializedNode) => n.label === 'Bar')).toBe(true);
    // the saved graph serves the core right away
    const ctx = run(CORE, { args: ['Bar'], env: env({ XRAY_GRAPH: out }), cwd: project });
    expect(ctx.stdout).toMatch(/^\[xray impact\] Bar \(graph saved 0m ago\)\n/);
  }, 90_000);

  test('claude: default target is <cwd>/.xray/graph.json', async () => {
    const e = env();
    delete e.XRAY_GRAPH;
    expect(run(CLAUDE_START, { input: startEvent(project), env: e }).status).toBe(0);
    const saved = path.join(project, '.xray', 'graph.json');
    expect(await waitFor(saved)).toBe(true);
    expect(await waitFor(sidecarOf(saved))).toBe(true);
    // happy path: save-graph, then the core trusts what it wrote
    expect(run(CORE, { args: ['Bar'], env: e, cwd: project }).stdout).toMatch(/^\[xray impact\] Bar \(graph saved 0m ago\)\n/);
    // sidecar: per-user, private
    expect(fs.statSync(path.dirname(sidecarOf(saved))).mode & 0o777).toBe(0o700);
    expect(fs.statSync(sidecarOf(saved)).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(sidecarOf(saved), 'utf8')).toBe(`${sha256(fs.readFileSync(saved))}\n`);
    // no temp file or lock left behind
    expect(fs.readdirSync(path.join(project, '.xray')).filter(f => f.startsWith('.graph.saving') || f.endsWith('.lock'))).toEqual([]);
  }, 90_000);

  test('gemini: SessionStart additionalContext JSON; graph lands', async () => {
    const out = path.join(project, 'g', 'graph.json');
    const r = run(GEMINI_START, { input: startEvent(project), env: env({ XRAY_GRAPH: out }) });
    expect([r.status, r.stderr]).toEqual([0, '']);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: expect.stringMatching(/^\[xray\] /) },
    });
    expect(await waitFor(out)).toBe(true);
  }, 90_000);

  test('nerv: SessionStart envelope -> allow + context; graph lands', async () => {
    const out = path.join(project, 'n', 'graph.json');
    const ev = JSON.stringify({ event: 'SessionStart', session: { id: 's', cwd: project }, payload: { source: 'startup' } });
    const r = run(NERV_SAVE, { input: ev, env: env({ XRAY_GRAPH: out }) });
    expect([r.status, r.stderr]).toEqual([0, '']);
    expect(JSON.parse(r.stdout)).toEqual({ action: 'allow', context: expect.stringMatching(/^\[xray\] /) });
    expect(await waitFor(out)).toBe(true);
  }, 90_000);

  test('nerv: lint probe {} (cwd = a git repo) is a bare allow and saves nothing', async () => {
    const out = path.join(project, 'probe', 'graph.json');
    const r = run(NERV_SAVE, { input: '{}', env: env({ XRAY_GRAPH: out }), cwd: project });
    expect([r.status, r.stderr, JSON.parse(r.stdout)]).toEqual([0, '', { action: 'allow' }]);
    await new Promise(res => setTimeout(res, 1500));
    expect(fs.existsSync(out)).toBe(false);
  }, 30_000);

  test.each([
    ['claude', CLAUDE_START],
    ['gemini', GEMINI_START],
  ])('%s: outside a git work tree nothing is saved and nothing printed', async (_n, script) => {
    const bare = path.join(outside(), 'notrepo');
    fs.mkdirSync(bare);
    fs.writeFileSync(path.join(bare, 'a.go'), 'package p\n');
    const out = path.join(tmp, 'nope', 'graph.json');
    const r = run(script, { input: startEvent(bare), env: env({ XRAY_GRAPH: out, GIT_CEILING_DIRECTORIES: path.dirname(bare) }) });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
    await new Promise(res => setTimeout(res, 1500));
    expect(fs.existsSync(out)).toBe(false);
  }, 30_000);

  test('xray not on PATH: silent, exit 0', () => {
    const r = run(CLAUDE_START, { input: startEvent(project), env: env({ PATH: '/usr/bin:/bin' }) });
    expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  });
});

d(`trust model: only graphs save-graph.sh wrote reach the model${skipNote}`, () => {
  const silent = (r: SpawnSyncReturns<string>) => expect([r.status, r.stdout, r.stderr]).toEqual([0, '', '']);
  const core = (extra: Record<string, string> = {}, cwd = tmp) => run(CORE, { args: ['RunHooks'], env: env(extra), cwd });
  const noGraphEnv = () => { const e = env(); delete e.XRAY_GRAPH; return e; };
  const defaultGraph = () => {
    fs.mkdirSync(path.join(tmp, '.xray'), { recursive: true });
    const g = path.join(tmp, '.xray', 'graph.json');
    fs.copyFileSync(graph, g);
    trust(g);
    return g;
  };

  test('committed .xray/graph.json: silent', () => {
    defaultGraph();
    expect(run(CORE, { args: ['RunHooks'], env: noGraphEnv() }).stdout).toMatch(MARKER);
    git(tmp, 'add', '-f', '.xray/graph.json');
    git(tmp, 'commit', '-qm', 'graph');
    silent(run(CORE, { args: ['RunHooks'], env: noGraphEnv() }));
  });

  test('committed graph via XRAY_GRAPH: silent', () => {
    expect(core().stdout).toMatch(MARKER);
    git(tmp, 'add', 'graph.json');
    silent(core());
  });

  test('.xray/ holding any tracked file: silent', () => {
    defaultGraph();
    expect(run(CORE, { args: ['RunHooks'], env: noGraphEnv() }).stdout).toMatch(MARKER);
    fs.writeFileSync(path.join(tmp, '.xray', 'notes.txt'), 'x');
    git(tmp, 'add', '-f', '.xray/notes.txt');
    silent(run(CORE, { args: ['RunHooks'], env: noGraphEnv() }));
  });

  test('graph without a sidecar: silent', () => {
    fs.rmSync(sidecarOf(graph));
    silent(core());
  });

  test('graph changed after the save: silent', () => {
    expect(core().stdout).toMatch(MARKER);
    fs.appendFileSync(graph, ' ');
    silent(core());
  });

  test('sidecar is keyed by the graph path: another path with the same bytes stays silent', () => {
    const other = path.join(tmp, 'other.json');
    fs.copyFileSync(graph, other);
    silent(core({ XRAY_GRAPH: other }));
  });

  test('symlinked .xray (even into the work tree): silent', () => {
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    fs.copyFileSync(graph, path.join(real, 'graph.json'));
    fs.symlinkSync(real, path.join(tmp, '.xray'));
    // sidecar for the path the hook would compute if it ignored the link
    trust(path.join(tmp, '.xray', 'graph.json'), path.join(fs.realpathSync(tmp), '.xray', 'graph.json'));
    trust(path.join(real, 'graph.json'));
    silent(run(CORE, { args: ['RunHooks'], env: noGraphEnv() }));
  });

  test('graph file that is a symlink (into the work tree): silent', () => {
    fs.mkdirSync(path.join(tmp, '.xray'));
    const link = path.join(tmp, '.xray', 'graph.json');
    fs.symlinkSync(graph, link);
    trust(link, path.join(fs.realpathSync(path.join(tmp, '.xray')), 'graph.json'));
    silent(run(CORE, { args: ['RunHooks'], env: noGraphEnv() }));
  });

  test('graph resolving outside the work tree: silent', () => {
    const out = outside();
    const g = path.join(out, 'graph.json');
    fs.copyFileSync(graph, g);
    trust(g);
    silent(core({ XRAY_GRAPH: g }));
    // via a symlinked parent further up (the graph's own dir is real)
    fs.mkdirSync(path.join(out, 'sub'));
    fs.copyFileSync(graph, path.join(out, 'sub', 'graph.json'));
    trust(path.join(out, 'sub', 'graph.json'));
    fs.symlinkSync(out, path.join(tmp, 'link'));
    silent(core({ XRAY_GRAPH: path.join(tmp, 'link', 'sub', 'graph.json') }));
  });

  test('outside any git work tree: silent', () => {
    const out = outside();
    const g = path.join(out, 'graph.json');
    fs.copyFileSync(graph, g);
    trust(g);
    silent(core({ XRAY_GRAPH: g, GIT_CEILING_DIRECTORIES: path.dirname(out) }, out));
  });

  test('control characters in graph text reach the context only as escaped plain text; newlines kept', () => {
    const ESC = '\u001b';
    const evil = tag(`cmd/${ESC}[2J${ESC}]0;title\u0007re\rplay.go`, `Rep${ESC}[31mlay\u0000\u0008\u009b6n\u0085`, 12);
    const evil2 = tag('internal/dispatch/dispatch.go', `Disp${ESC}]8;;http://x${ESC}\\atch\u007f\t`, 85, 'func\u0007tion');
    fs.writeFileSync(graph, JSON.stringify(graphOf([RUN, evil2, evil, LONELY], [calls(evil2, RUN), calls(evil, RUN)])));
    trust(graph);
    const r = core();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(MARKER);
    // eslint-disable-next-line no-control-regex
    expect(r.stdout).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    // xray escapes before the hook sees it: the text is readable, not stripped
    expect(r.stdout).toContain('\\x1b[2J');
    expect(r.stdout).toContain('\\x07');
    expect(r.stdout).toContain('\\r');
    expect(r.stdout).toContain('2 callers across 2 groups');
    expect(r.stdout.split('\n').length).toBeGreaterThan(3);
  });

  test('the hook still strips raw control input by itself (stub xray emitting raw sequences)', () => {
    const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-stub-'));
    try {
      const ESC = '\u001b';
      fs.writeFileSync(path.join(stub, 'xray'),
        `#!/bin/sh\nprintf 'RunHooks (a.go:L1) \\033[2J\\033]0;title\\007 -- 1 caller\\r\\n  x: y\\n'\n`, { mode: 0o755 });
      const e = env();
      e.PATH = `${stub}${path.delimiter}${e.PATH}`;
      const r = run(CORE, { args: ['RunHooks'], env: e });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(MARKER);
      // eslint-disable-next-line no-control-regex
      expect(r.stdout).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
      expect(r.stdout).not.toMatch(/title|\[2J/);
      expect(ESC).toBe('\u001b');
    } finally {
      fs.rmSync(stub, { recursive: true, force: true });
    }
  });
});

d(`save-graph.sh refuses unsafe targets${skipNote}`, () => {
  let project: string;
  let out: string;

  beforeEach(() => {
    project = path.join(tmp, 'proj');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'a.go'), 'package p\n\nfunc Foo() { Bar() }\n\nfunc Bar() {}\n');
    git(project, 'init', '-q');
    out = outside();
    fs.rmSync(path.join(xdg, 'xray'), { recursive: true, force: true }); // drop the shared fixture's sidecar
  });

  const save = (extra: Record<string, string> = {}) => {
    const e = env(extra);
    if (!('XRAY_GRAPH' in extra)) delete e.XRAY_GRAPH;
    return run(SAVE, { args: [project], env: e, cwd: tmp });
  };
  const settle = () => new Promise(res => setTimeout(res, 4000));
  const sidecars = () => fs.existsSync(path.join(xdg, 'xray', 'hooks')) ? fs.readdirSync(path.join(xdg, 'xray', 'hooks')) : [];

  test('symlinked .xray pointing outside: writes nothing there, no sidecar', async () => {
    fs.symlinkSync(out, path.join(project, '.xray'));
    expect(save()).toMatchObject({ status: 0, stdout: '', stderr: '' });
    await settle();
    expect(fs.readdirSync(out)).toEqual([]);
    expect(sidecars()).toEqual([]);
  }, 30_000);

  test('symlinked .xray pointing into the work tree: writes nothing', async () => {
    fs.mkdirSync(path.join(project, 'real'));
    fs.symlinkSync(path.join(project, 'real'), path.join(project, '.xray'));
    expect(save()).toMatchObject({ status: 0, stdout: '' });
    await settle();
    expect(fs.readdirSync(path.join(project, 'real'))).toEqual([]);
    expect(sidecars()).toEqual([]);
  }, 30_000);

  test('graph path that is a symlink: target untouched', async () => {
    fs.mkdirSync(path.join(project, '.xray'));
    const target = path.join(out, 'victim');
    fs.writeFileSync(target, 'keep');
    fs.symlinkSync(target, path.join(project, '.xray', 'graph.json'));
    expect(save()).toMatchObject({ status: 0, stdout: '' });
    await settle();
    expect(fs.readFileSync(target, 'utf8')).toBe('keep');
    expect(fs.lstatSync(path.join(project, '.xray', 'graph.json')).isSymbolicLink()).toBe(true);
    expect(sidecars()).toEqual([]);
  }, 30_000);

  test('lock path that is a symlink: writes nothing', async () => {
    fs.mkdirSync(path.join(project, '.xray'));
    fs.symlinkSync(out, path.join(project, '.xray', 'graph.json.lock'));
    expect(save()).toMatchObject({ status: 0, stdout: '' });
    await settle();
    expect(fs.readdirSync(out)).toEqual([]);
    expect(fs.readdirSync(path.join(project, '.xray'))).toEqual(['graph.json.lock']);
  }, 30_000);

  test('XRAY_GRAPH outside the work tree: writes nothing', async () => {
    expect(save({ XRAY_GRAPH: path.join(out, 'sub', 'graph.json') })).toMatchObject({ status: 0, stdout: '' });
    await settle();
    expect(fs.readdirSync(out)).toEqual([]);
  }, 30_000);

  test('XRAY_GRAPH through a symlinked parent leading outside: writes nothing', async () => {
    fs.mkdirSync(path.join(out, 'sub'));
    fs.symlinkSync(out, path.join(project, 'link'));
    expect(save({ XRAY_GRAPH: path.join(project, 'link', 'sub', 'graph.json') })).toMatchObject({ status: 0, stdout: '' });
    await settle();
    expect(fs.readdirSync(path.join(out, 'sub'))).toEqual([]);
    expect(save({ XRAY_GRAPH: path.join(project, 'link', 'new', 'graph.json') })).toMatchObject({ status: 0, stdout: '' });
    await settle();
    expect(fs.readdirSync(out).sort()).toEqual(['sub']);
  }, 30_000);
});

describe('per-harness README config snippets', () => {
  const fenced = (file: string, lang: string) => {
    const text = fs.readFileSync(file, 'utf8');
    return [...text.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map(m => m[1]);
  };
  const scriptRefs = (text: string) =>
    [...text.matchAll(/hooks\/harness\/[A-Za-z0-9_./-]+/g)].map(m => m[0]);

  test('claude settings.json snippet parses; PreToolUse Grep|Bash, timeouts, SessionStart', () => {
    const [snippet] = fenced(path.join(HOOKS, 'claude', 'README.md'), 'json');
    const cfg = JSON.parse(snippet);
    const pre = cfg.hooks.PreToolUse[0];
    expect(pre.matcher).toBe('Grep|Bash');
    expect(pre.hooks[0]).toMatchObject({ type: 'command', timeout: 10 });
    expect(pre.hooks[0].command).toMatch(/claude\/pretooluse-impact\.sh$/);
    expect(cfg.hooks.SessionStart[0].hooks[0].command).toMatch(/claude\/session-start\.sh$/);
    for (const ref of scriptRefs(snippet)) expect(fs.existsSync(path.join(REPO, ref))).toBe(true);
  });

  test('nerv hooks.yaml snippet parses; PreToolUse match, timeout', () => {
    const [snippet] = fenced(path.join(HOOKS, 'nerv', 'README.md'), 'yaml');
    const cfg = yaml.load(snippet) as { version: string; hooks: Array<Record<string, unknown>> };
    expect(cfg.version).toBe('1.0-draft');
    const hook = cfg.hooks.find(h => h.name === 'xray-impact');
    expect(hook).toMatchObject({ on: 'PreToolUse', timeout: 8 });
    expect(String(hook?.match)).toMatch(/Bash/);
    expect(new RegExp(String(hook?.match)).test('Grep')).toBe(true);
    expect(String(hook?.run)).toMatch(/nerv\/xray-impact\.sh$/);
    expect(cfg.hooks.find(h => h.name === 'xray-save-graph')).toMatchObject({ on: 'SessionStart' });
    expect(String(cfg.hooks.find(h => h.name === 'xray-save-graph')?.run)).toMatch(/nerv\/xray-save-graph\.sh$/);
    for (const ref of scriptRefs(snippet)) expect(fs.existsSync(path.join(REPO, ref))).toBe(true);
  });

  (has('nerv') ? test : test.skip)(`nerv lint accepts the hooks.yaml snippet${has('nerv') ? '' : ' [skipped: nerv not installed]'}`, () => {
    const [snippet] = fenced(path.join(HOOKS, 'nerv', 'README.md'), 'yaml');
    const file = path.join(tmp, 'hooks.yaml');
    fs.writeFileSync(file, snippet.replace(/\/home\/you\/\.local\/share\/xray\//g, `${REPO}/`));
    const r = spawnSync('nerv', ['lint', file], {
      cwd: tmp, encoding: 'utf8', timeout: 30_000,
      env: { ...env(), XDG_CONFIG_HOME: path.join(tmp, 'cfg'), XDG_DATA_HOME: path.join(tmp, 'data'), XDG_STATE_HOME: path.join(tmp, 'st') },
    });
    expect(r.stdout + r.stderr).toContain('No issues found');
    expect(r.status).toBe(0);
  });

  test('gemini settings.json snippet parses; AfterTool matcher covers the search and shell tools', () => {
    const [snippet] = fenced(path.join(HOOKS, 'gemini', 'README.md'), 'json');
    const cfg = JSON.parse(snippet);
    const after = cfg.hooks.AfterTool[0];
    const re = new RegExp(`^(?:${after.matcher})$`);
    for (const t of ['grep_search', 'search_file_content', 'run_shell_command']) expect(re.test(t)).toBe(true);
    expect(re.test('read_file')).toBe(false);
    expect(after.hooks[0]).toMatchObject({ type: 'command' });
    expect(after.hooks[0].command).toMatch(/gemini\/after-tool-impact\.sh$/);
    expect(cfg.hooks.BeforeTool).toBeUndefined();
    expect(cfg.hooks.SessionStart[0].hooks[0].command).toMatch(/gemini\/session-start\.sh$/);
    for (const ref of scriptRefs(snippet)) expect(fs.existsSync(path.join(REPO, ref))).toBe(true);
  });
});
