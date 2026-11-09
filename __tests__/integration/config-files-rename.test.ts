/**
 * The config-file strategy is `config-files`. `config` stays as a hidden
 * alias that forwards to it: it works, but appears in no help, describe,
 * strategy list or MCP tool list.
 */
import { createCliProject, type CliProject } from '../support/cli-project';

describe('config-files strategy name', () => {
  let p: CliProject;
  beforeAll(() => {
    p = createCliProject({
      '.env': 'API_KEY=abc\nDEBUG=true\n',
      'package.json': '{"name":"x"}',
    });
  });
  afterAll(() => p.cleanup());

  it('config-files list / keys / values work', () => {
    expect(p.run('config-files', 'list').stdout).toContain('.env');
    expect(p.run('config-files', 'keys', '--file', '.env').stdout).toContain('API_KEY');
    expect(p.run('config-files', 'values', '--file', '.env').stdout).toContain('DEBUG');
  });

  it('config-files list --format json', () => {
    const r = p.run('config-files', 'list', '--format', 'json');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).files).toContain('.env');
  });

  it('hidden alias: config <verb> gives the same result', () => {
    for (const args of [['list'], ['keys', '--file', '.env'], ['values', '--file', '.env']]) {
      const a = p.run('config', ...args);
      const b = p.run('config-files', ...args);
      expect(a.status).toBe(0);
      expect(a.stdout).toBe(b.stdout);
    }
  });

  it('hidden alias accepts -p and --format json like the real command', () => {
    const r = p.run('config', 'list', '-p', p.root, '--format', 'json');
    expect(r.status).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  it('root help lists config-files, not config', () => {
    const rows = p.run('--help-strategy').stdout.split('\n').map((l) => l.trim().split(/\s+/)[0]);
    expect(rows).toContain('config-files');
    expect(rows).not.toContain('config');
  });

  it('--help-all and describe omit the alias', () => {
    const all = p.run('--help-all').stdout;
    expect(all).toMatch(/^config-files list\b/m);
    expect(all).not.toMatch(/^config (list|keys|values)\b/m);
    const names = JSON.parse(p.run('describe').stdout).commands.map((c: { name: string }) => c.name);
    expect(names).toContain('config-files');
    expect(names).not.toContain('config');
  });

  it('strategy list and detect name config-files, not config', () => {
    for (const args of [['strategy', 'list', '--format', 'json'], ['strategy', 'detect']]) {
      const out = p.run(...args).stdout;
      expect(out).toContain('config-files');
      expect(out).not.toMatch(/"?\bconfig\b"?\s*(v0|,|:|$)/m);
    }
    const names = JSON.parse(p.run('strategy', 'list', '--format', 'json').stdout)
      .map((s: { name: string }) => s.name);
    expect(names).toContain('config-files');
    expect(names).not.toContain('config');
  });

  it('strategy info works under the new name', () => {
    expect(p.run('strategy', 'info', 'config-files').status).toBe(0);
  });

  it('an alias may target config-files, and its name is reserved', () => {
    expect(p.run('alias', 'set', 'cfgs', 'config-files list').status).toBe(0);
    expect(p.run('cfgs').stdout).toContain('.env');
    expect(p.run('alias', 'set', 'config-files', 'build targets').status).toBe(4);
  });
});
