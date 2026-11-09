/** --help must not embed the absolute working directory as a flag default. */
import { createCliProject, type CliProject } from '../support/cli-project';

describe('help output is cwd-independent', () => {
  let p: CliProject;
  beforeAll(() => { p = createCliProject({ 'package.json': '{"name":"x"}' }); });
  afterAll(() => p.cleanup());

  const cases: string[][] = [['lang', 'list'], ['paths'], ['express', 'routes'], ['build', 'targets']];
  it.each(cases)('xray %s --help', (...argv) => {
    const r = p.run(...argv, '--help');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain(p.root);
    expect(r.stdout.replace(/\s+/g, ' ')).toContain('current directory');
  });

  it('lang list still inspects the cwd without -p', () => {
    const r = p.run('lang', 'list', '--json');
    expect(r.status).toBe(0);
  });
});
