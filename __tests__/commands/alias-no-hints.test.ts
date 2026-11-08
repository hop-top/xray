/** `--no-hints` drops alias next-step hints, wherever the flag sits. */
import { createCliProject, type CliProject } from '../support/cli-project';

describe('alias --no-hints', () => {
  let p: CliProject;
  beforeAll(() => { p = createCliProject({ 'package.json': '{"name":"x"}' }); });
  afterAll(() => p.cleanup());
  const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;

  it('alias list prints the hint by default', () => {
    expect(out(p.run('alias', 'list'))).toContain('Create .xrayrc.json');
  });
  it.each([
    ['root flag', ['--no-hints', 'alias', 'list']],
    ['leaf flag', ['alias', 'list', '--no-hints']],
  ])('alias list: %s', (_n, argv) => {
    const r = p.run(...(argv as string[]));
    expect(r.status).toBe(0);
    expect(out(r)).not.toContain('Create .xrayrc.json');
    expect(out(r)).toContain('No configuration file found');
  });
  it('alias set drops the next-run hint', () => {
    const r = p.run('--no-hints', 'alias', 'set', 'cmp', 'react components');
    expect(out(r)).toContain('Created alias');
    expect(out(r)).not.toContain('next xray run');
  });
});
