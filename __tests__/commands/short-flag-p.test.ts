/** `-p` is `--path` on every command that has `--path`, and means nothing else anywhere. */
import { createCliProject, type CliProject } from '../support/cli-project';

interface Doc { qualifiedName: string; options: Array<{ name: string; short: string | null }>; subcommands: Doc[] }

describe('-p is --path', () => {
  let p: CliProject;
  let all: Doc[];
  beforeAll(() => {
    p = createCliProject({ 'package.json': '{"name":"x"}' });
    const walk = (d: Doc): Doc[] => [d, ...d.subcommands.flatMap(walk)];
    all = (JSON.parse(p.run('describe').stdout).commands as Doc[]).flatMap(walk);
  });
  afterAll(() => p.cleanup());

  it('covers a real tree', () => {
    expect(all.filter((c) => c.options.some((o) => o.name === '--path')).length).toBeGreaterThan(20);
  });

  it('every --path has short -p', () => {
    const bad = all
      .filter((c) => c.options.some((o) => o.name === '--path' && o.short !== '-p'))
      .map((c) => c.qualifiedName);
    expect(bad).toEqual([]);
  });

  it('-p is never anything but --path', () => {
    const bad = all
      .filter((c) => c.options.some((o) => o.short === '-p' && o.name !== '--path'))
      .map((c) => c.qualifiedName);
    expect(bad).toEqual([]);
  });
});
