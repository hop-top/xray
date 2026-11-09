import * as fs from 'fs';
import * as path from 'path';
import { registerStrategyCommand } from '../../src/commands/strategy-cmd';

const root = path.resolve(__dirname, '../..');

describe('pre-commit hook', () => {
  const hook = fs.readFileSync(path.join(root, '.husky/pre-commit'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  it('runs only npm scripts that exist', () => {
    const names = [...hook.matchAll(/npm run (\S+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(pkg.scripts[n]).toBeDefined();
  });

  it('detect script invokes a real strategy subcommand (not explore fallthrough)', () => {
    const script: string = pkg.scripts['strategy:detect'];
    const m = script.match(/^node dist\/index\.js strategy (\S+)/);
    expect(m).not.toBeNull();
    const subs = registerStrategyCommand().commands.map((c) => c.name());
    expect(subs).toContain(m![1]);
  });
});
