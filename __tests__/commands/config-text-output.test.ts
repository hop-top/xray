/** `config list|keys|values` in text mode print the listing once, no JSON after it. */
import { createCliProject, type CliProject } from '../support/cli-project';

describe('config text output', () => {
  let p: CliProject;
  beforeAll(() => {
    p = createCliProject({
      'package.json': '{"name":"x"}',
      '.env': 'A=1\nSECRET_KEY=x\n',
      'config.json': '{"a":{"b":1}}\n',
    });
  });
  afterAll(() => p.cleanup());

  it.each([
    ['list', 'Total: 2 file(s)'],
    ['keys', 'Total: 3 key(s)'],
    ['values', 'A = 1'],
  ])('config %s: listing only', (sub, expected) => {
    const r = p.run('config', sub);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(expected);
    expect(r.stdout).not.toMatch(/[{}]/);
    expect(r.stdout).not.toContain('"count"');
  });

  it('--format text behaves like the default', () => {
    expect(p.run('config', 'list', '--format', 'text').stdout).not.toMatch(/[{}]/);
  });

  it('--format json still yields the data', () => {
    expect(JSON.parse(p.run('config', 'list', '--format', 'json').stdout).count).toBe(2);
    expect(JSON.parse(p.run('config', 'keys', '--format', 'json').stdout).count).toBe(3);
  });
});

describe('config list ignores node_modules at any depth', () => {
  let p: CliProject;
  beforeAll(() => {
    p = createCliProject({
      'package.json': '{"name":"x"}',
      'config.json': '{"a":1}\n',
      'node_modules/dep/config.json': '{"d":1}\n',
      'sub/node_modules/dep/config.json': '{"d":1}\n',
      'sub/config.json': '{"s":1}\n',
    });
  });
  afterAll(() => p.cleanup());

  it('lists project files only', () => {
    const doc = JSON.parse(p.run('config', 'list', '--format', 'json').stdout);
    expect(doc.files.sort()).toEqual(['config.json', 'sub/config.json']);
  });
});
