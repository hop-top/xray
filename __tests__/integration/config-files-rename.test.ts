/**
 * The config-file strategy is `config-files`, distinct from xray's own
 * `config` management group (`config path`, `config paths`).
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

  it('config is xray own config group (path / paths), separate from config-files', () => {
    const r = p.run('config', 'paths', '--format', 'json');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).projectRoot).toBeDefined();
    expect(p.run('config', 'list').status).toBe(2);
  });

  it('strategy group lists config-files, not config', () => {
    const rows = p.run('--help-strategy').stdout.split('\n').map((l) => l.trim().split(/\s+/)[0]);
    expect(rows).toContain('config-files');
    expect(rows).not.toContain('config');
  });

  it('--help-all and spec expose both config (management) and config-files (strategy)', () => {
    const all = p.run('--help-all').stdout;
    expect(all).toMatch(/^\s+config-files\b/m);
    expect(all).toMatch(/^\s+config\b/m);
    const names = JSON.parse(p.run('spec').stdout).commands.map((c: { name: string }) => c.name);
    expect(names).toContain('config-files');
    expect(names).toContain('config');
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

  it('strategy show works under config-files', () => {
    expect(p.run('strategy', 'show', 'config-files').status).toBe(0);
  });

  it('an alias may target config-files, and its name is reserved', () => {
    expect(p.run('alias', 'set', 'cfgs', 'config-files list').status).toBe(0);
    expect(p.run('cfgs').stdout).toContain('.env');
    expect(p.run('alias', 'set', 'config-files', 'build targets').status).toBe(4);
  });
});
