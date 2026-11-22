import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectLanguage,
  isSupportedFallbackFile,
  linguistExtensions,
} from '../src/lib/parser/linguist-map';
import {
  extractFallbackTags,
  resetCtagsProbeCache,
} from '../src/lib/parser/ctags-fallback';
import * as execModule from '../src/utils/execFileNoThrow';
import { Xray } from '../src/lib/xray';

describe('linguist-map', () => {
  it('maps 100+ extensions and exact filenames to canonical lowercase language names', () => {
    expect(linguistExtensions().length).toBeGreaterThanOrEqual(100);

    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('deploy/Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('Makefile')).toBe('makefile');
    expect(detectLanguage('build/Makefile')).toBe('makefile');

    const cases: Array<[string, string]> = [
      ['main.zig', 'zig'],
      ['app.nim', 'nim'],
      ['lib.dart', 'dart'],
      ['init.lua', 'lua'],
      ['schema.sql', 'sql'],
      ['api.proto', 'protobuf'],
      ['query.graphql', 'graphql'],
      ['main.tf', 'terraform'],
      ['config.hcl', 'hcl'],
      ['App.svelte', 'svelte'],
      ['App.vue', 'vue'],
      ['analysis.r', 'r'],
      ['calc.jl', 'julia'],
      ['core.clj', 'clojure'],
      ['server.erl', 'erlang'],
      ['parser.ml', 'ocaml'],
      ['script.pl', 'perl'],
      ['setup.ps1', 'powershell'],
    ];

    for (const [file, expected] of cases) {
      expect(detectLanguage(file)).toBe(expected);
      expect(isSupportedFallbackFile(file)).toBe(true);
    }

    expect(detectLanguage('unknown.xyz123')).toBeNull();
    expect(isSupportedFallbackFile('unknown.xyz123')).toBe(false);
    expect(isSupportedFallbackFile('Dockerfile')).toBe(true);
    expect(isSupportedFallbackFile('Makefile')).toBe(true);
  });
});

describe('ctags-fallback', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetCtagsProbeCache();
  });

  it('uses Universal Ctags NDJSON output when ctags with json feature is available', async () => {
    const spy = jest.spyOn(execModule, 'execFileNoThrow').mockImplementation(async (cmd, args = []) => {
      if (cmd === 'ctags' && args.includes('--list-features')) {
        return { status: 0, stdout: 'json\nregex\n', stderr: '' };
      }
      if (cmd === 'ctags' && args.includes('--output-format=json')) {
        const ndjson = [
          JSON.stringify({ _type: 'tag', name: 'greet', kind: 'function', line: 3, signature: '(name)' }),
          JSON.stringify({ _type: 'tag', name: 'Greeter', kind: 'class', line: 10 }),
        ].join('\n');
        return { status: 0, stdout: ndjson, stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'unexpected' };
    });

    const tags = await extractFallbackTags('/tmp/init.lua', 'init.lua', 'local function greet(name) end\n');

    expect(spy).toHaveBeenCalledWith('ctags', ['--list-features']);
    expect(spy).toHaveBeenCalledWith('ctags', ['--output-format=json', '--fields=+nKS', '-f', '-', '/tmp/init.lua']);
    expect(tags).toEqual([
      expect.objectContaining({
        file: 'init.lua',
        name: 'greet',
        kind: 'function',
        line: 2,
        signature: '(name)',
        source: 'ctags',
      }),
      expect.objectContaining({
        file: 'init.lua',
        name: 'Greeter',
        kind: 'class',
        line: 9,
        source: 'ctags',
      }),
    ]);
  });

  it('falls back to conservative regex extraction when ctags is absent', async () => {
    jest.spyOn(execModule, 'execFileNoThrow').mockResolvedValue({
      status: 1,
      stdout: '',
      stderr: 'ctags: command not found',
      error: new Error('ENOENT'),
    });

    const content = [
      '// comment',
      'export fn buildWidget() {}',
      'func handleRequest() {}',
      'def compute_score():',
      'class Engine:',
      'struct Point {',
      'enum Color {',
      'interface Reader {',
      'type UserId = string',
      'message HelloRequest {',
      'service Greeter {',
      'resource web_server {',
    ].join('\n');

    const tags = await extractFallbackTags('/tmp/sample.zig', 'sample.zig', content);
    const names = tags.map(t => t.name);

    expect(names).toEqual([
      'buildWidget',
      'handleRequest',
      'compute_score',
      'Engine',
      'Point',
      'Color',
      'Reader',
      'UserId',
      'HelloRequest',
      'Greeter',
      'web_server',
    ]);
    expect(tags[0].line).toBe(1);
    expect(tags.every(t => t.source === 'regex')).toBe(true);
  });
});

describe('Xray fallback scanning and ParseCoverage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-ctags-fallback-'));
    resetCtagsProbeCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetCtagsProbeCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers .lua, .tf, and Dockerfile, extracts fallback tags, and reports ParseCoverage.fallback', async () => {
    jest.spyOn(execModule, 'execFileNoThrow').mockResolvedValue({
      status: 1,
      stdout: '',
      stderr: 'not found',
    });

    fs.writeFileSync(path.join(tmpDir, 'main.ts'), 'export function mainTs() { return 1; }\n');
    fs.writeFileSync(path.join(tmpDir, 'helper.lua'), 'fn luaHelper()\n');
    fs.writeFileSync(path.join(tmpDir, 'infra.tf'), 'resource web_box {\n}\n');
    fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM node:20\n');

    const xray = new Xray({ path: tmpDir, cachePath: path.join(tmpDir, '.cache.db') });
    xray.disableFileCache();
    const { graph } = await xray.buildGraph();

    expect(graph.hasNode('main.ts')).toBe(true);
    expect(graph.hasNode('helper.lua')).toBe(true);
    expect(graph.hasNode('infra.tf')).toBe(true);
    expect(graph.hasNode('Dockerfile')).toBe(true);
    expect(graph.hasNode('helper.lua::luaHelper')).toBe(true);
    expect(graph.hasNode('infra.tf::web_box')).toBe(true);

    const coverage = xray.getLastCoverage();
    expect(coverage).toBeDefined();
    expect(coverage!.files).toBe(4);
    expect(coverage!.parsed).toBe(4);
    expect(coverage!.fallback).toEqual({ ctags: 0, regex: 3 });
  });

  it('skips fallback files when fallbackCtags is false', async () => {
    fs.writeFileSync(path.join(tmpDir, 'main.ts'), 'export function mainTs() { return 1; }\n');
    fs.writeFileSync(path.join(tmpDir, 'helper.lua'), 'fn luaHelper()\n');
    fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM node:20\n');

    const xray = new Xray({
      path: tmpDir,
      cachePath: path.join(tmpDir, '.cache.db'),
      fallbackCtags: false,
    });
    xray.disableFileCache();
    const { graph } = await xray.buildGraph();

    expect(graph.hasNode('main.ts')).toBe(true);
    expect(graph.hasNode('helper.lua')).toBe(false);
    expect(graph.hasNode('Dockerfile')).toBe(false);

    const coverage = xray.getLastCoverage();
    expect(coverage!.files).toBe(1);
    expect(coverage!.parsed).toBe(1);
    expect(coverage!.fallback).toBeUndefined();
  });
});
