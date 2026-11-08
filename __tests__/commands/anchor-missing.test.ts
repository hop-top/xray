/** A missing --anchor target is not found (exit 3), not silently ignored. */
import { createCliProject, type CliProject } from '../support/cli-project';

describe('--anchor target must exist', () => {
  let p: CliProject;
  beforeAll(() => {
    p = createCliProject({ 'package.json': '{"name":"x"}', 'src/a.ts': 'export function a() { return 1; }\n' });
  });
  afterAll(() => p.cleanup());

  it.each(['map', 'graph'])('%s: missing anchor -> exit 3 naming it', (cmd) => {
    const r = p.run(cmd, '.', '--anchor', 'src/nope.ts', '--no-chunk');
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('src/nope.ts');
  });

  it('a directory is not an anchor', () => {
    expect(p.run('map', '.', '--anchor', 'src').status).toBe(3);
  });

  it('existing anchor still works', () => {
    expect(p.run('map', '.', '--anchor', 'src/a.ts', '--no-chunk').status).toBe(0);
  });
});
