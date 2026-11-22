/**
 * Tests for the warm in-process MCP workspace engine, direct tool registry,
 * initialize instructions, and context root confinement.
 */
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { registerCoreCommands } from '../src/commands/registration/core';
import {
  createXrayBridge,
  createXrayMcpHandler,
  MCP_INSTRUCTIONS,
  type DirectToolDef,
} from '../src/lib/mcp/server';
import { WarmWorkspaceManager } from '../src/lib/mcp/workspace';

function buildTestProgram(): Command {
  const prog = new Command('xray');
  registerCoreCommands(prog);
  return prog;
}

describe('MCP warm workspace engine', () => {
  let sandbox: string;
  let repo: string;
  let outside: string;
  let globalCfgDir: string;
  let prevXdgConfigHome: string | undefined;
  let prevHome: string | undefined;

  beforeEach(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-warm-')));
    repo = path.join(sandbox, 'repo');
    outside = path.join(sandbox, 'outside');
    const home = path.join(sandbox, 'home');
    globalCfgDir = path.join(home, '.config', 'xray');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(outside, 'src'), { recursive: true });
    fs.mkdirSync(globalCfgDir, { recursive: true });

    fs.writeFileSync(
      path.join(repo, 'src', 'a.ts'),
      'export function alpha(): number {\n  return 1;\n}\n'
    );
    fs.writeFileSync(
      path.join(repo, 'src', 'b.ts'),
      'import { alpha } from "./a";\nexport function beta(): number {\n  return alpha();\n}\n'
    );
    fs.writeFileSync(
      path.join(outside, 'src', 'secret.ts'),
      'export function outsideFn(): number {\n  return 42;\n}\n'
    );

    prevXdgConfigHome = process.env.XDG_CONFIG_HOME;
    prevHome = process.env.HOME;
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  });

  afterEach(() => {
    if (prevXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdgConfigHome;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(sandbox, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('(a) repeat impact and query MCP calls hit warm memory with 0 child spawns', async () => {
    // `import * as childProcess` is wrapped in non-configurable getters by
    // ts-jest, so spy on the CommonJS module object itself.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const spawnSpy = jest.spyOn(require('child_process') as typeof childProcess, 'spawn');
    const workspace = new WarmWorkspaceManager(repo, null);
    try {
      const handler = createXrayMcpHandler(buildTestProgram(), {
        serverRoot: repo,
        serverConfig: null,
        entry: path.resolve(__dirname, '../dist/index.js'),
        timeoutMs: 30_000,
        version: '0.0.0-test',
        workspace,
      });

      // Cold impact call
      const r1 = await handler({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'impact', arguments: { symbol: 'alpha', format: 'json' } },
        }),
      });
      const body1 = JSON.parse(r1.body);
      expect(body1.result.isError).toBe(false);
      const parsed1 = JSON.parse(body1.result.content[0].text);
      expect(parsed1.nodes.map((n: any) => n.name)).toEqual(['beta']);

      // Warm repeat impact call -> 0ms memory hit
      const warmCheck = await workspace.getGraph(repo, {});
      expect(warmCheck.hit).toBe(true);

      const r2 = await handler({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'impact', arguments: { symbol: 'alpha', format: 'json' } },
        }),
      });
      const body2 = JSON.parse(r2.body);
      expect(body2.result.isError).toBe(false);
      expect(JSON.parse(body2.result.content[0].text).nodes.map((n: any) => n.name)).toEqual(['beta']);

      // Warm query call on the same graph
      const r3 = await handler({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'query', arguments: { query: 'callers(alpha)', format: 'json' } },
        }),
      });
      const body3 = JSON.parse(r3.body);
      expect(body3.result.isError).toBe(false);
      expect(JSON.parse(body3.result.content[0].text).nodes.map((n: any) => n.name)).toContain('beta');

      expect(spawnSpy).not.toHaveBeenCalled();
    } finally {
      workspace.close();
    }
  });

  it('(b) editing 1 file refreshes the warm graph incrementally', async () => {
    const workspace = new WarmWorkspaceManager(repo, null);
    try {
      const first = await workspace.getGraph(repo, {});
      expect(first.hit).toBe(false);
      expect(first.incremental).toBe(false);

      // Edit 1 file (add gamma calling beta)
      const cPath = path.join(repo, 'src', 'c.ts');
      fs.writeFileSync(
        cPath,
        'import { beta } from "./b";\nexport function gamma(): number {\n  return beta();\n}\n'
      );
      // Ensure mtime differs if filesystem granularity is coarse
      const future = new Date(Date.now() + 2000);
      fs.utimesSync(cPath, future, future);

      const patched = await workspace.getGraph(repo, {});
      expect(patched.hit).toBe(false);
      expect(patched.incremental).toBe(true);

      const handler = createXrayMcpHandler(buildTestProgram(), {
        serverRoot: repo,
        serverConfig: null,
        entry: path.resolve(__dirname, '../dist/index.js'),
        timeoutMs: 30_000,
        version: '0.0.0-test',
        workspace,
      });

      const res = await handler({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'impact', arguments: { symbol: 'alpha', format: 'json' } },
        }),
      });
      const parsed = JSON.parse(JSON.parse(res.body).result.content[0].text);
      expect(parsed.nodes.map((n: any) => n.name).sort()).toEqual(['beta', 'gamma']);
    } finally {
      workspace.close();
    }
  });

  it('(c) initialize returns tool-selection instructions', async () => {
    const workspace = new WarmWorkspaceManager(repo, null);
    try {
      const handler = createXrayMcpHandler(buildTestProgram(), {
        serverRoot: repo,
        serverConfig: null,
        entry: path.resolve(__dirname, '../dist/index.js'),
        timeoutMs: 30_000,
        version: '1.2.3',
        workspace,
      });

      const res = await handler({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
          },
        }),
      });
      const rpc = JSON.parse(res.body);
      expect(rpc.result.instructions).toBe(MCP_INSTRUCTIONS);
      expect(rpc.result.instructions).toMatch(/explore/i);
      expect(rpc.result.instructions).toMatch(/map/i);
      expect(rpc.result.instructions).toMatch(/query/i);
      expect(rpc.result.instructions).toMatch(/impact/i);
      expect(rpc.result.instructions).toMatch(/read_file/i);
    } finally {
      workspace.close();
    }
  });

  it('(d) repo-local contexts pointing outside serverRoot are rejected while global config contexts are allowed', () => {
    const localCfgPath = path.join(repo, '.xrayrc.json');
    fs.writeFileSync(
      localCfgPath,
      JSON.stringify({
        contexts: {
          inside: { include: ['src'] },
          escaping: { include: ['../outside'] },
        },
      })
    );

    const workspace = new WarmWorkspaceManager(repo, fs.realpathSync(localCfgPath));
    try {
      // Inside context is allowed
      expect(workspace.containAcrossAllowedRoots('src/a.ts').root).toBe(repo);
      // Repo-local escaping context is rejected
      expect(() => workspace.containAcrossAllowedRoots(outside)).toThrow(/outside/);
    } finally {
      workspace.close();
    }

    // Now authorize `outside` via user global config
    fs.writeFileSync(
      path.join(globalCfgDir, 'config.json'),
      JSON.stringify({
        contexts: {
          ext: { include: [outside] },
        },
      })
    );

    const workspaceWithGlobal = new WarmWorkspaceManager(repo, fs.realpathSync(localCfgPath));
    try {
      const contained = workspaceWithGlobal.containAcrossAllowedRoots(path.join(outside, 'src', 'secret.ts'));
      expect(contained.root).toBe(outside);
    } finally {
      workspaceWithGlobal.close();
    }
  });

  it('merges directTools registry into createXrayBridge leaves() and invoke()', async () => {
    const workspace = new WarmWorkspaceManager(repo, null);
    try {
      const directTools = new Map<string, DirectToolDef>([
        [
          'ping_direct',
          {
            name: 'ping_direct',
            description: 'Direct test tool',
            properties: { msg: { type: 'string', description: 'Message' } },
            required: ['msg'],
            invoke: async (args) => ({
              stdout: `direct:${args?.msg ?? ''}`,
              stderr: '',
              exitCode: 0,
            }),
          },
        ],
      ]);

      const bridge = createXrayBridge(buildTestProgram(), {
        serverRoot: repo,
        serverConfig: null,
        entry: path.resolve(__dirname, '../dist/index.js'),
        timeoutMs: 30_000,
        workspace,
        directTools,
      });

      const names = bridge.leaves().map((l) => l.path[0]);
      expect(names).toContain('ping_direct');
      expect(names).toContain('impact');

      const res = await bridge.invoke({ path: ['ping_direct'], flags: { msg: 'hello' }, args: [] });
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toBe('direct:hello');
    } finally {
      workspace.close();
    }
  });
});
