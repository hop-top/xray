/** `strategy create` must not scaffold a file that shadows a built-in strategy. */
import * as fs from 'fs';
import * as path from 'path';
import { createCliProject, type CliProject } from '../support/cli-project';

describe('strategy create refuses built-in names', () => {
  let p: CliProject;
  beforeAll(() => { p = createCliProject({ 'package.json': '{"name":"x"}' }); });
  afterAll(() => p.cleanup());

  it.each(['react', 'express', 'config-files', 'config'])('%s -> usage error, nothing written', (name) => {
    const r = p.run('strategy', 'create', name);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('built-in');
    expect(fs.existsSync(path.join(p.root, '.xray'))).toBe(false);
  });

  it('--dry-run refuses too', () => {
    expect(p.run('strategy', 'create', 'react', '--dry-run').status).toBe(2);
  });

  it('a custom name still works', () => {
    const r = p.run('strategy', 'create', 'my-own');
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(p.root, '.xray/strategies/my-own.yml'))).toBe(true);
  });
});
