import { Command } from 'commander';
import * as path from 'path';
import { addExploreOutputFlags, handleExploreAction } from '../../src/commands/explore';

const FIXTURE = path.resolve(__dirname, '../fixtures/plumbing');

describe('xray explore output (kit dispatch)', () => {
  let writeSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  const captured = () => writeSpy.mock.calls.map((c) => String(c[0])).join('');

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    errSpy = jest.spyOn(console, 'error').mockImplementation();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });
  afterEach(() => {
    writeSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  async function explore(...args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    const cmd = program
      .command('explore')
      .option('-p, --path <path>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('-m, --match <pattern>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('-s, --search <keyword>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('-t, --type <ext>', '', (v: string, p: string[]) => p.concat([v]), [])
      .option('--stats');
    addExploreOutputFlags(cmd).action((opts, c) => handleExploreAction(opts, c));
    await program.parseAsync(['node', 'test', 'explore', '-p', FIXTURE, ...args]);
  }

  it('stats: json records per extension; totals match the text view', async () => {
    await explore('--stats', '--format', 'json');
    const rows = JSON.parse(captured());
    expect(rows).toEqual([{ type: '.ts', files: 6, lines: expect.any(Number) }]);

    writeSpy.mockClear();
    await explore('--stats');
    expect(captured()).toContain('Total Files: 6');
    expect(captured()).toContain(`Total Lines: ${rows[0].lines}`);
  });

  it('search: one record per matching line (untruncated)', async () => {
    await explore('-s', 'alpha', '--format', 'csv', '--cols', 'line,keyword');
    expect(captured().split('\n')[0]).toBe('line,keyword');
    expect(captured().trim().split('\n').length - 1).toBe(4);
  });

  it('search with no hits: empty json array', async () => {
    await explore('-s', 'no-such-keyword-zz', '--format', 'json');
    expect(captured()).toBe('[]\n');
  });

  it('match: path records', async () => {
    await explore('-m', 'imports/*', '--format', 'json');
    const rows = JSON.parse(captured());
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0])).toEqual(['path']);
  });

  it('default listing: type/path records through kit table', async () => {
    await explore('--format', 'table');
    const lines = captured().trimEnd().split('\n');
    expect(lines[0].trim().split(/\s+/)).toEqual(['type', 'path']);
    expect(lines).toHaveLength(7);
  });

  it('unknown format is a usage error', async () => {
    await expect(explore('--format', 'xml')).rejects.toMatchObject({ exitCode: 2 });
  });
});
