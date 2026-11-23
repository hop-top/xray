/** `xray --help-all`: reveals hidden MANAGEMENT and STRATEGY command groups. */
import { createCliProject, type CliProject } from '../support/cli-project';

describe('--help-all', () => {
  let p: CliProject;
  beforeAll(() => { p = createCliProject({ 'package.json': '{"name":"x"}' }); });
  afterAll(() => p.cleanup());

  it('default --help hides MANAGEMENT and STRATEGY groups and shows core groups', () => {
    const r = p.run('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ANALYZE');
    expect(r.stdout).toContain('COMPOSE');
    expect(r.stdout).toContain('LIFECYCLE');
    expect(r.stdout).toContain('INTERACT');
    expect(r.stdout).not.toMatch(/^MANAGEMENT$/m);
    expect(r.stdout).not.toMatch(/^STRATEGY$/m);
    expect(r.stdout).toContain('--help-all');
  });

  it('prints every group including MANAGEMENT and STRATEGY, exit 0', () => {
    const r = p.run('--help-all');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ANALYZE');
    expect(r.stdout).toContain('MANAGEMENT');
    expect(r.stdout).toContain('STRATEGY');
    expect(r.stdout).toMatch(/^\s+map\b/m);
    expect(r.stdout).toMatch(/^\s+strategy\b/m);
    expect(r.stdout).toMatch(/^\s+config\b/m);
    expect(r.stdout).toMatch(/^\s+spec\b/m);
    expect(r.stdout).toMatch(/^\s+build\b/m);
    expect(r.stdout).toMatch(/^\s+impact\b/m);
  });

  it('omits removed commands', () => {
    const out = p.run('--help-all').stdout;
    expect(out).not.toMatch(/^\s+clear-cache\b/m);
    expect(out).not.toMatch(/^\s+graph\b/m);
    expect(out).not.toMatch(/^\s+mcp\b/m);
  });
});
