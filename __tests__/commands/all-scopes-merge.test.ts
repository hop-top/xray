/**
 * `--all-scopes` resolves each scope's options exactly as `--scope <name>`
 * does, for every option `map|graph` declares: no option is dropped, and
 * CLI beats scope config. Checked on the merged options, so an option with
 * no visible effect on a small fixture is still covered.
 */
import { Command } from 'commander';
import { resolveAllScopesRuns, resolveRunOptions } from '../../src/commands/generate';
import { addCommonOptions } from '../../src/commands/common';
import { UsageError } from '../../src/lib/error/types';

const config: any = {
  scopes: {
    ts: { paths: ['./src'], match: ['*.ts'], limit: 100, depth: 2, output: 'scope-out' },
    go: { paths: ['./pkg'], catch: ['Handler'], languages: ['go'] },
  },
};

/** Parse `args` on a command carrying the shared analysis options. */
const parse = (args: string[]): any => {
  const cmd = addCommonOptions(new Command().exitOverride());
  cmd.parse(args, { from: 'user' });
  const o = cmd.opts();
  return { ...o, outputFormat: o.format };
};

/** Value for each option, as a user would type it. */
const ARGS: Array<[string, string[]]> = [
  ['--path', ['--path', 'cli-dir']],
  ['--output', ['--output', 'cli-out']],
  ['--limit', ['--limit', '7']],
  ['--with', ['--with', 'vars']],
  ['--anchor', ['--anchor', 'x.ts']],
  ['--depth', ['--depth', '9']],
  ['--query', ['--query', '.ts:q']],
  ['--match', ['--match', '*.py']],
  ['--catch', ['--catch', 'Other']],
  ['--format', ['--format', 'xml']],
  ['--txt', ['--txt']],
  ['--csv', ['--csv']],
  ['--xml', ['--xml']],
  ['--json', ['--json']],
  ['--no-chunk', ['--no-chunk']],
  ['--group', ['--group', 'community']],
  ['--detect', ['--detect']],
  ['--lang', ['--lang', 'python']],
  ['--skip-detect', ['--skip-detect']],
  ['--share', ['--share']],
  ['--preset', ['--preset', 'insights']],
];

describe('resolveAllScopesRuns', () => {
  it('declares a case for every option addCommonOptions registers', () => {
    const cmd = addCommonOptions(new Command());
    const registered = cmd.options.map((o) => o.long!);
    const covered = new Set([
      ...ARGS.map(([n]) => n),
      '--enable-extension', '--disable-extension', '--extension-threshold',
      '--extension-hint', '--enable-surface', '--disable-surface', // folded into `extensions`, below
      '--lens', '--scope', '--all-scopes', // select the run; not forwarded content
      '--mermaid', '--dot', // diagram family selectors
    ]);
    expect(registered.filter((n) => !covered.has(n))).toEqual([]);
  });

  it.each(ARGS)('%s: each scope run equals the --scope run', (_n, args) => {
    const cli = parse(args);
    const runs = resolveAllScopesRuns(cli, config);
    expect(runs.map((r) => r.scopeName)).toEqual(['ts', 'go']);
    for (const { scopeName, mergedOptions } of runs) {
      expect(mergedOptions).toEqual(resolveRunOptions({ ...cli, scope: scopeName }, config).mergedOptions);
    }
  });

  it('CLI value beats the scope config in every scope', () => {
    const runs = resolveAllScopesRuns(parse(['--match', '*.py', '--limit', '7']), config);
    for (const r of runs) {
      expect(r.mergedOptions.match).toEqual(['*.py']);
      expect(r.mergedOptions.limit).toBe('7');
    }
  });

  it('scope config applies where the CLI is silent', () => {
    const [ts, go] = resolveAllScopesRuns(parse([]), config);
    expect(ts.mergedOptions.path).toEqual(['./src']);
    expect(ts.mergedOptions.match).toEqual(['*.ts']);
    expect(go.mergedOptions.catch).toEqual(['Handler']);
  });

  it('--group reaches the run options', () => {
    for (const r of resolveAllScopesRuns(parse(['--group', 'community']), config)) {
      expect(r.mergedOptions.group).toBe('community');
    }
  });

  it('no scopes: UsageError', () => {
    expect(() => resolveAllScopesRuns(parse([]), { scopes: {} })).toThrow(UsageError);
    expect(() => resolveAllScopesRuns(parse([]), null)).toThrow(/no scopes are defined/);
  });
});
