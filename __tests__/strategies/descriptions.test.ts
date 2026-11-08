import * as fs from 'fs';
import * as path from 'path';
import { strategyToExtension } from '../../src/lib/strategy/types';

const dir = path.join(__dirname, '../../strategies');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'nextjs.ts');

describe('built-in strategy descriptions', () => {
  it.each(files)('%s has a real group description', async f => {
    const Cls = (await import(path.join(dir, f))).default;
    const s = new Cls();
    if (!s.commands || Object.keys(s.commands).length === 0) return;
    expect(typeof s.description).toBe('string');
    expect(s.description).not.toMatch(/ commands$/);
    expect(s.description.length).toBeGreaterThan(15);
    expect(strategyToExtension(s).description).toBe(s.description);
  });
});
