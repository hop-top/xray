// __tests__/lib/markdown-links.test.ts
import * as path from 'path';
import { extractMarkdownLinks, resolveLinkTarget } from '../../src/lib/markdown/links';

const root = path.resolve('/repo/docs');
const from = path.join(root, 'guide', 'index.md');

describe('resolveLinkTarget', () => {
  test.each([
    ['commands.md', path.join(root, 'guide', 'commands.md')],
    ['./commands.md', path.join(root, 'guide', 'commands.md')],
    ['../top.md', path.join(root, 'top.md')],
    ['/ref/api.md', path.join(root, 'ref', 'api.md')],
    ['sub%20dir/a.md', path.join(root, 'guide', 'sub dir', 'a.md')],
  ])('%s → file', (target, expected) => {
    expect(resolveLinkTarget(target, from, root)).toEqual({ kind: 'file', path: expected });
  });

  test('strips #anchor and ?query', () => {
    expect(resolveLinkTarget('a.md?plain=1#usage', from, root)).toEqual({
      kind: 'file', path: path.join(root, 'guide', 'a.md'), anchor: 'usage',
    });
  });

  test.each(['https://e.x/a.md', 'http://e.x', 'mailto:a@e.x'])('%s → external', (t) => {
    expect(resolveLinkTarget(t, from, root)).toEqual({ kind: 'external' });
  });

  test('#anchor alone → self', () => {
    expect(resolveLinkTarget('#usage', from, root)).toEqual({ kind: 'self', anchor: 'usage' });
  });
});

describe('extractMarkdownLinks', () => {
  test('prose links only, with titles, angle brackets and ref definitions', () => {
    const text = [
      '[A](a.md "Title") ![I](<img.png>)',
      '```',
      '[X](code.md)',
      '```',
      'Use `[Y](inline.md)` here.',
      '[ref]: ref.md',
    ].join('\n');
    expect(extractMarkdownLinks(text).map(l => [l.line, l.target])).toEqual([
      [1, 'a.md'], [1, 'img.png'], [6, 'ref.md'],
    ]);
  });
});
