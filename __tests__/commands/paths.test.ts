import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerPathsCommand } from '../../src/commands/paths';
import { projectCacheDbPath, projectTelemetryPath } from '../../src/lib/storage';

async function runPaths(...args: string[]): Promise<void> {
  const program = new Command();
  registerPathsCommand(program);
  await program.parseAsync(['node', 'test', 'paths', ...args]);
}

describe('xray paths command', () => {
  let writeSpy: jest.SpyInstance;
  let tmpRoot: string;
  const captured = () => writeSpy.mock.calls.map(c => String(c[0])).join('');

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-paths-test-'));
  });

  afterEach(() => {
    writeSpy.mockRestore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('prints text-format report containing project-root and cache-db lines', async () => {
    await runPaths('--path', tmpRoot, '--format', 'text');
    const output = captured();
    expect(output).toContain(`project-root:    ${tmpRoot}`);
    expect(output).toContain(
      `cache-db:        ${projectCacheDbPath(tmpRoot)}`
    );
    expect(output).toContain(`telemetry:       ${projectTelemetryPath(tmpRoot)}`);
    expect(output).toContain('(not yet created)');
  });

  it('detects an existing .xrayrc.json as project-config', async () => {
    const cfg = path.join(tmpRoot, '.xrayrc.json');
    fs.writeFileSync(cfg, '{}');

    await runPaths('--path', tmpRoot, '--format', 'text');
    const output = captured();
    expect(output).toContain(`project-config:  ${cfg}`);
  });

  it('emits valid JSON when format=json', async () => {
    await runPaths('--path', tmpRoot, '--format', 'json');
    const raw = captured();
    const parsed = JSON.parse(raw);
    expect(parsed.projectRoot).toBe(tmpRoot);
    expect(parsed.cacheDb).toBe(projectCacheDbPath(tmpRoot));
    expect(parsed.cacheDb.startsWith(tmpRoot)).toBe(false);
    expect(parsed.telemetry).toBe(projectTelemetryPath(tmpRoot));
    expect(parsed.telemetry.startsWith(tmpRoot)).toBe(false);
    expect(parsed.cacheDbExists).toBe(false);
  });

  it('registers as a `paths` subcommand on the given program', async () => {
    await runPaths('--path', tmpRoot);

    const output = captured();
    expect(output).toContain('project-root:');
    expect(output).toContain(tmpRoot);
  });

  it('reports kit XDG config/data/cache/state dirs (text + json)', async () => {
    const xdg = require('@hop-top/kit/xdg');
    const expected = {
      configDir: xdg.configDir('xray'),
      dataDir: xdg.dataDir('xray'),
      cacheDir: xdg.cacheDir('xray'),
      stateDir: xdg.stateDir('xray'),
    };

    await runPaths('--path', tmpRoot, '--format', 'json');
    const parsed = JSON.parse(captured());
    expect(parsed).toMatchObject(expected);

    writeSpy.mockClear();
    await runPaths('--path', tmpRoot, '--format', 'text');
    const text = captured();
    expect(text).toContain(`config-dir:      ${expected.configDir}`);
    expect(text).toContain(`data-dir:        ${expected.dataDir}`);
    expect(text).toContain(`cache-dir:       ${expected.cacheDir}`);
    expect(text).toContain(`state-dir:       ${expected.stateDir}`);
  });

  it('keeps json byte-identical to the historical JSON.stringify(report, null, 2)', async () => {
    await runPaths('--path', tmpRoot, '--format', 'json');
    const out = captured();
    expect(out).toBe(JSON.stringify(JSON.parse(out), null, 2) + '\n');
    expect(Object.keys(JSON.parse(out))).toEqual([
      'projectRoot', 'projectConfig', 'globalConfig', 'cacheDb', 'cacheDbExists', 'telemetry',
      'configDir', 'dataDir', 'cacheDir', 'stateDir',
    ]);
  });

  it('supports kit formats: yaml, csv, table with --cols', async () => {
    await runPaths('--path', tmpRoot, '--format', 'yaml');
    expect(captured()).toContain(`projectRoot: ${tmpRoot}`);

    writeSpy.mockClear();
    await runPaths('--path', tmpRoot, '--format', 'csv', '--cols', 'projectRoot,cacheDbExists');
    expect(captured()).toBe(`projectRoot,cacheDbExists\n${tmpRoot},false\n`);

    writeSpy.mockClear();
    await runPaths('--path', tmpRoot, '--format', 'table', '--cols', 'cacheDbExists');
    expect(captured().split('\n')[0].trim()).toBe('cacheDbExists');
  });

  it('writes to a file with -o and infers format from the extension', async () => {
    const out = path.join(tmpRoot, 'paths.json');
    await runPaths('--path', tmpRoot, '-o', out);
    expect(JSON.parse(fs.readFileSync(out, 'utf-8')).projectRoot).toBe(tmpRoot);
  });

  it('rejects an unknown format with a usage error', async () => {
    await expect(runPaths('--path', tmpRoot, '--format', 'xml')).rejects.toMatchObject({ exitCode: 2 });
  });

  it('rejects an unknown column with a usage error', async () => {
    await expect(
      runPaths('--path', tmpRoot, '--format', 'table', '--cols', 'nope')
    ).rejects.toMatchObject({ exitCode: 2 });
  });
});
