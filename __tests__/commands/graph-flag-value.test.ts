/** `--graph` without a file must not swallow the next option. */
import { createCliProject, type CliProject } from '../support/cli-project';

describe('--graph needs a file', () => {
  let p: CliProject;
  beforeAll(() => { p = createCliProject({ 'package.json': '{"name":"x"}' }); });
  afterAll(() => p.cleanup());

  it.each([
    ['query', '--graph', '--format', 'json', 'calls(main)'],
    ['impact', 'main', '--graph', '--format', 'json'],
  ])('%s: flag-shaped value is a usage error naming --graph', (...argv) => {
    const r = p.run(...argv);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--graph');
    expect(r.stderr).not.toContain('too many arguments');
  });

  it('a real file still reaches the not-found path', () => {
    const r = p.run('query', '--graph', 'nope.json', 'calls(main)');
    expect(r.status).toBe(3);
  });
});
