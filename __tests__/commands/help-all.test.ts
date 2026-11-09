/** `xray --help-all`: full command tree with every command's flags, as text. */
import { createCliProject, type CliProject } from '../support/cli-project';

describe('--help-all', () => {
  let p: CliProject;
  beforeAll(() => { p = createCliProject({ 'package.json': '{"name":"x"}' }); });
  afterAll(() => p.cleanup());

  it('prints every command and its flags, exit 0', () => {
    const r = p.run('--help-all');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^map\b/m);
    expect(r.stdout).toMatch(/^ {2}-p, --path <value>/m);
    expect(r.stdout).toContain('--limit <number>');
    expect(r.stdout).toMatch(/^strategy list\b/m);
    expect(r.stdout).toMatch(/^build run\b/m);
    expect(r.stdout).toMatch(/^impact\b/m);
  });

  it('omits hidden commands', () => {
    expect(p.run('--help-all').stdout).not.toMatch(/^clear-cache\b/m);
  });

  it('is mentioned by --help', () => {
    const r = p.run('--help');
    expect(r.stdout).toContain('--help-all');
    expect(r.stdout).toContain('every command');
  });
});
