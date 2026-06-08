import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handlePathsAction, registerPathsCommand } from '../../src/commands/paths';

describe('xray paths command', () => {
  let consoleLogSpy: jest.SpyInstance;
  let tmpRoot: string;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-paths-test-'));
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('prints text-format report containing project-root and cache-db lines', () => {
    handlePathsAction({ path: tmpRoot, format: 'text' });
    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain(`project-root:    ${tmpRoot}`);
    expect(output).toContain(
      `cache-db:        ${path.join(tmpRoot, '.xray_cache.db')}`
    );
    expect(output).toContain('(not yet created)');
  });

  it('detects an existing .xrayrc.json as project-config', () => {
    const cfg = path.join(tmpRoot, '.xrayrc.json');
    fs.writeFileSync(cfg, '{}');

    handlePathsAction({ path: tmpRoot, format: 'text' });
    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain(`project-config:  ${cfg}`);
  });

  it('emits valid JSON when format=json', () => {
    handlePathsAction({ path: tmpRoot, format: 'json' });
    const raw = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    const parsed = JSON.parse(raw);
    expect(parsed.projectRoot).toBe(tmpRoot);
    expect(parsed.cacheDb).toBe(path.join(tmpRoot, '.xray_cache.db'));
    expect(parsed.cacheDbExists).toBe(false);
  });

  it('registers as a `paths` subcommand on the given program', async () => {
    const program = new Command();
    registerPathsCommand(program);
    await program.parseAsync(['node', 'test', 'paths', '--path', tmpRoot]);

    const output = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(output).toContain('project-root:');
    expect(output).toContain(tmpRoot);
  });
});
