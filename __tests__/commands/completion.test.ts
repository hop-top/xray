/**
 * Shell completion: kit's cobra-protocol scripts + `xray __complete`.
 *
 * - In-process: value completers bound by bindValueCompleters answer
 *   `__complete` requests on a synthetic tree.
 * - Built bin: `__complete` walks the real tree (core, nested strategy
 *   subcommands, per-command flags, user aliases) without side effects.
 * - Real shells: the generated bash/zsh/fish scripts drive `__complete`
 *   end to end (skipped when the shell is not installed).
 *
 * Build first: npm run build.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';

const ROOT = path.resolve(__dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'xray');

/** Same module instances for binding and answering (resetModules is on). */
function load() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const xc = require('../../src/commands/completion') as typeof import('../../src/commands/completion');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const kit = require('@hop-top/kit/completion') as typeof import('@hop-top/kit/dist/completion');
  return { xc, kit };
}

async function ask(program: Command, words: string[]): Promise<{ lines: string[]; directive: number }> {
  const { kit } = load();
  let out = '';
  await kit.completeRequest(program, words, false, { out: (s) => { out += s; }, err: () => {} });
  const lines = out.trimEnd().split('\n');
  const last = lines.pop() ?? '';
  return { lines, directive: Number(last.slice(1)) };
}

function syntheticProgram(): Command {
  const program = new Command('xray')
    .option('--log-level <level>', 'level')
    .option('-C, --chdir <path>', 'chdir')
    .option('--config <path>', 'config');
  program.command('map')
    .option('-p, --path <path>', 'path')
    .option('-o, --output <path>', 'out')
    .option('--lang <list>', 'langs')
    .option('--group <mode>', 'group')
    .option('--json', 'boolean flag, never bound');
  program.command('query').option('--graph <file>', 'graph');
  const lang = program.command('lang');
  lang.command('add <names...>');
  return program;
}

describe('completion: value completers (in-process)', () => {
  const FILTER_FILE_EXT = 8;
  const FILTER_DIRS = 16;
  const NO_FILE_COMP = 4;

  it('isCompletionRequest matches only __complete / __completeNoDesc', () => {
    const { xc } = load();
    expect(xc.isCompletionRequest(['node', 'xray', '__complete', ''])).toBe(true);
    expect(xc.isCompletionRequest(['node', 'xray', '__completeNoDesc', ''])).toBe(true);
    expect(xc.isCompletionRequest(['node', 'xray', 'completion', 'bash'])).toBe(false);
    expect(xc.isCompletionRequest(['node', 'xray'])).toBe(false);
  });

  it('binds root --log-level values and -C/--config file kinds', async () => {
    const { xc } = load();
    const p = syntheticProgram();
    xc.bindValueCompleters(p);

    const lvl = await ask(p, ['--log-level', '']);
    expect(lvl.lines).toEqual(['silent', 'error', 'warn', 'info', 'debug']);
    expect(lvl.directive).toBe(NO_FILE_COMP);

    expect((await ask(p, ['-C', ''])).directive).toBe(FILTER_DIRS);
    expect((await ask(p, ['map', '-p', ''])).directive).toBe(FILTER_DIRS);
  });

  it('--graph filters to .json files', async () => {
    const { xc } = load();
    const p = syntheticProgram();
    xc.bindValueCompleters(p);
    const r = await ask(p, ['query', '--graph', '']);
    expect(r.lines).toEqual(['json']);
    expect(r.directive).toBe(FILTER_FILE_EXT);
  });

  it('--group offers chunk grouping modes', async () => {
    const { xc } = load();
    const p = syntheticProgram();
    xc.bindValueCompleters(p);
    expect((await ask(p, ['map', '--group', ''])).lines).toEqual(['directory', 'community']);
  });

  it('--lang completes the last comma-separated element', async () => {
    const { xc } = load();
    const p = syntheticProgram();
    xc.bindValueCompleters(p);
    const r = await ask(p, ['map', '--lang', 'go,ty']);
    expect(r.lines.map((l) => l.split('\t')[0])).toEqual(['go,typescript']);
  });

  it('lang add completes language packs and bundles', async () => {
    const { xc } = load();
    const p = syntheticProgram();
    xc.bindValueCompleters(p);
    const r = await ask(p, ['lang', 'add', 'sys']);
    expect(r.lines).toEqual(['systems\tbundle: c, cpp, rust, go']);
  });
});

// ---------------------------------------------------------------------------
// Built bin
// ---------------------------------------------------------------------------

let sandbox: string;
let env: NodeJS.ProcessEnv;

function xray(args: string[], cwd = sandbox, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(BIN, args, { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 30_000 });
}

function values(stdout: string): string[] {
  return stdout.trimEnd().split('\n').slice(0, -1).map((l) => l.split('\t')[0]);
}

beforeAll(() => {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) {
    throw new Error('dist/ missing: run `npm run build` first');
  }
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xray-completion-')));
  fs.mkdirSync(path.join(sandbox, 'bin'));
  fs.symlinkSync(BIN, path.join(sandbox, 'bin', 'xray'));
  env = {
    PATH: `${path.join(sandbox, 'bin')}${path.delimiter}${process.env.PATH}`,
    HOME: sandbox,
    XDG_CONFIG_HOME: path.join(sandbox, '.config'),
    XDG_CACHE_HOME: path.join(sandbox, '.cache'),
    NO_COLOR: '1',
    LANG: 'C',
  };
});

afterAll(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('completion: xray completion <shell>', () => {
  it.each([
    ['bash', '__start_xray'],
    ['zsh', '#compdef xray'],
    ['fish', 'complete -c xray'],
    ['powershell', 'Register-ArgumentCompleter'],
  ])('%s script calls back into __complete', (shell, marker) => {
    const r = xray(['completion', shell]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(marker);
    expect(r.stdout).toContain('__complete');
  });

  it('unsupported shell is a usage error (exit 2)', () => {
    const r = xray(['completion', 'pwsh']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain("unsupported shell 'pwsh' (expected one of: bash, zsh, fish, powershell)");
  });

  it('missing shell is a usage error (exit 2)', () => {
    const r = xray(['completion']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('missing shell');
  });
});

describe('completion: xray __complete', () => {
  it('root offers core, strategy and alias commands', () => {
    const cwd = fs.mkdtempSync(path.join(sandbox, 'alias-'));
    fs.writeFileSync(
      path.join(cwd, '.xrayrc.json'),
      JSON.stringify({ telemetry: { enabled: false }, aliases: { rc: 'react components' } })
    );
    const r = xray(['__complete', ''], cwd);
    expect(r.status).toBe(0);
    const v = values(r.stdout);
    for (const name of ['map', 'query', 'strategy', 'lang', 'cache', 'paths', 'describe', 'react', 'express', 'rc']) {
      expect(v).toContain(name);
    }
    expect(r.stdout).toMatch(/^rc\tAlias for: react components$/m);
    // kit keeps its `completion` builtin out of root suggestions.
    expect(v).not.toContain('completion');
  });

  function aliasProject(): string {
    const cwd = fs.mkdtempSync(path.join(sandbox, 'alias-'));
    fs.writeFileSync(
      path.join(cwd, '.xrayrc.json'),
      JSON.stringify({ telemetry: { enabled: false }, aliases: { rc: 'react components' } })
    );
    return cwd;
  }

  it('lists an alias once, as the real command', () => {
    const r = xray(['__complete', 'r'], aliasProject());
    expect(r.status).toBe(0);
    expect(values(r.stdout).filter((v) => v === 'rc')).toEqual(['rc']);
    expect(r.stdout).toMatch(/^rc\tAlias for: react components$/m);
  });

  it('completes an alias with its own flags', () => {
    const v = values(xray(['__complete', 'rc', '-'], aliasProject()).stdout);
    expect(v).toEqual(expect.arrayContaining(['-p', '--path', '-h', '--help']));
  });

  it('nested strategy subcommands and their flags', () => {
    expect(values(xray(['__complete', 'react', '']).stdout)).toEqual(['components', 'contexts', 'hooks']);
    expect(values(xray(['__complete', 'react', 'components', '--fo']).stdout)).toContain('--format');
    expect(values(xray(['__complete', 'react', 'components', '--format', '']).stdout)).toEqual(
      expect.arrayContaining(['json', 'yaml', 'table', 'csv', 'text'])
    );
  });

  it('per-command --format values', () => {
    expect(values(xray(['__complete', 'map', '--format', '']).stdout)).toEqual(
      ['txt', 'json', 'csv', 'xml']
    );
    expect(values(xray(['__complete', 'query', '--format', '']).stdout).sort()).toEqual(
      ['csv', 'json', 'table', 'tree', 'yaml']
    );
    expect(values(xray(['__complete', 'lang', 'list', '--format', '']).stdout)).toEqual(['text', 'json']);
    expect(values(xray(['__complete', 'describe', '--format', '']).stdout)).toEqual(['json']);
  });

  it('completion <shell> values', () => {
    expect(values(xray(['__complete', 'completion', '']).stdout)).toEqual(
      ['bash', 'fish', 'powershell', 'zsh']
    );
  });

  it('strategy info completes strategy names', () => {
    expect(values(xray(['__complete', 'strategy', 'info', 're']).stdout)).toEqual(['react', 'rest-api']);
  });

  it('runs no consent prompt, telemetry or config write', () => {
    const cwd = fs.mkdtempSync(path.join(sandbox, 'clean-'));
    const r = xray(['__complete', ''], cwd);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(cwd, '.xrayrc.json'))).toBe(false);
  });
});

/**
 * Tab runs `xray __complete` in whatever directory the shell is in, e.g. a
 * freshly cloned repo. Nothing from that directory may execute: project
 * strategies (`.xray/strategies`, `node_modules/xray-strategy-*`) write a
 * marker when loaded; JS config (`.xrayrc.js`, `xray.config.js`) is never
 * loaded at all, by completion or by any other run.
 */
describe('completion: never executes project code', () => {
  let marks: string;

  function markerModule(name: string, body: string): string {
    return `require('fs').writeFileSync(${JSON.stringify(path.join(marks, name))}, 'x');\n${body}\n`;
  }

  function untrustedProject(config: '.xrayrc.js' | 'xray.config.js'): string {
    const cwd = fs.mkdtempSync(path.join(sandbox, 'untrusted-'));
    const local = path.join(cwd, '.xray', 'strategies');
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, 'evil.js'), markerModule('local-strategy',
      "module.exports = { name: 'evil', version: '1.0.0', detect: () => false," +
      " commands: { pwn: { description: 'pwn', handler: () => null } } };"));

    const pkg = path.join(cwd, 'node_modules', 'xray-strategy-evilpkg');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
      name: 'xray-strategy-evilpkg',
      'xray-strategy': { name: 'evilpkg', entry: 'index.js' },
    }));
    fs.writeFileSync(path.join(pkg, 'index.js'), markerModule('npm-strategy',
      "module.exports = { name: 'evilpkg', version: '1.0.0', detect: () => false };"));

    fs.writeFileSync(path.join(cwd, config), markerModule(config,
      "module.exports = { aliases: { rc: 'react components' } };"));
    return cwd;
  }

  beforeEach(() => {
    marks = fs.mkdtempSync(path.join(sandbox, 'marks-'));
  });

  it.each([
    [['__complete', '']],
    [['__completeNoDesc', '']],
    [['__complete', 'strategy', 'info', '']],
    [['__complete', 'evil', '']],
  ])('%j loads no strategy or config code from cwd', (words: string[]) => {
    const cwd = untrustedProject('.xrayrc.js');
    const r = xray(words, cwd);
    expect(r.status).toBe(0);
    expect(fs.readdirSync(marks)).toEqual([]);
    // Nor does a tab write the strategy cache into the project.
    expect(fs.existsSync(path.join(cwd, '.xray', '.strategy-cache.json'))).toBe(false);
  });

  it('skips xray.config.js too', () => {
    const cwd = untrustedProject('xray.config.js');
    expect(xray(['__complete', ''], cwd).status).toBe(0);
    expect(fs.readdirSync(marks)).toEqual([]);
  });

  it('omits project strategies and JS-config aliases from candidates', () => {
    const cwd = untrustedProject('.xrayrc.js');
    const v = values(xray(['__complete', ''], cwd).stdout);
    expect(v).not.toContain('evil');
    expect(v).not.toContain('evilpkg');
    expect(v).not.toContain('rc');
    expect(values(xray(['__complete', 'strategy', 'info', 'ev'], cwd).stdout)).toEqual([]);
  });

  it('still completes built-in strategy subcommands, flags and names', () => {
    const cwd = untrustedProject('.xrayrc.js');
    const v = values(xray(['__complete', ''], cwd).stdout);
    for (const name of ['map', 'react', 'express', 'rest-api']) expect(v).toContain(name);
    expect(values(xray(['__complete', 'react', ''], cwd).stdout)).toEqual(['components', 'contexts', 'hooks']);
    expect(values(xray(['__complete', 'react', 'components', '--fo'], cwd).stdout)).toContain('--format');
    expect(values(xray(['__complete', 'strategy', 'info', 're'], cwd).stdout)).toEqual(['react', 'rest-api']);
  });

  it('explicit runs do not load project strategies without the opt-in', () => {
    const cwd = untrustedProject('.xrayrc.js');
    xray(['strategy', 'list'], cwd);
    expect(fs.readdirSync(marks)).toEqual([]);
  });

  it('explicit runs load project strategies with the opt-in, but never JS config', () => {
    const cwd = untrustedProject('.xrayrc.js');
    xray(['strategy', 'list'], cwd, { XRAY_ALLOW_PROJECT_STRATEGIES: '1' });
    const ran = fs.readdirSync(marks);
    expect(ran).toEqual(expect.arrayContaining(['local-strategy', 'npm-strategy']));
    expect(ran).not.toContain('.xrayrc.js');
  });
});

// ---------------------------------------------------------------------------
// Real shells
// ---------------------------------------------------------------------------

function which(cmd: string): string | null {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** bash >= 4 + bash-completion v2 (cobra's bash V2 script needs both). */
function bashWithCompletion(): { bash: string; lib: string } | null {
  const candidates = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/bin/bash', '/usr/bin/bash'];
  const libs = [
    '/opt/homebrew/share/bash-completion/bash_completion',
    '/usr/local/share/bash-completion/bash_completion',
    '/usr/share/bash-completion/bash_completion',
  ];
  const lib = libs.find((l) => fs.existsSync(l));
  if (!lib) return null;
  for (const b of candidates) {
    if (!fs.existsSync(b)) continue;
    const v = spawnSync(b, ['-c', 'echo ${BASH_VERSINFO[0]}'], { encoding: 'utf8' });
    if (Number(v.stdout.trim()) >= 4) return { bash: b, lib };
  }
  return null;
}

const bashEnv = bashWithCompletion();
const zsh = which('zsh');
const fish = which('fish');

const LINES = [
  'xray rea',
  'xray react ',
  'xray map --format ',
  'xray completion ',
  'xray strategy info re',
];

(bashEnv ? describe : describe.skip)('completion: bash end to end', () => {
  it('completes via the generated script', () => {
    const script = [
      `source ${bashEnv!.lib}`,
      'eval "$(xray completion bash)"',
      'comp() { COMP_LINE="$1"; COMP_POINT=${#COMP_LINE}; read -ra COMP_WORDS <<< "$COMP_LINE";',
      '  [[ "$COMP_LINE" == *" " ]] && COMP_WORDS+=(""); COMP_CWORD=$((${#COMP_WORDS[@]}-1));',
      '  COMPREPLY=(); __start_xray xray "${COMP_WORDS[COMP_CWORD]}" "${COMP_WORDS[COMP_CWORD-1]}" 2>/dev/null;',
      '  echo "$1|${COMPREPLY[*]}"; }',
      ...LINES.map((l) => `comp ${JSON.stringify(l)}`),
    ].join('\n');
    const r = spawnSync(bashEnv!.bash, ['-c', script], { cwd: sandbox, env, encoding: 'utf8', timeout: 60_000 });
    expect(r.stdout.trim().split('\n')).toEqual([
      'xray rea|react',
      'xray react |components contexts hooks',
      'xray map --format |txt json csv xml',
      'xray completion |bash fish powershell zsh',
      'xray strategy info re|react rest-api',
    ]);
  });
});

(zsh ? describe : describe.skip)('completion: zsh end to end', () => {
  it('completes via the generated _xray function', () => {
    // compsys builtins only exist inside a completion widget; stub the
    // three the cobra script hands results to and print what they get.
    const script = [
      'compdef() { :; }',
      '_describe() { local a; for a in "$@"; do [[ $a == completions ]] && { print -r -- "${(j: :)${(@)completions%%:*}}"; return 0; }; done; }',
      '_arguments() { print -r -- "args: $*"; }',
      'compadd() { :; }',
      'eval "$(xray completion zsh)"',
      'comp() { words=(${=1}); [[ "$1" == *" " ]] && words+=(""); CURRENT=${#words}; print -rn -- "$1|"; _xray; }',
      ...LINES.map((l) => `comp ${JSON.stringify(l)}`),
      'comp "xray map -p "',
    ].join('\n');
    const r = spawnSync(zsh!, ['-f', '-c', script], { cwd: sandbox, env, encoding: 'utf8', timeout: 60_000 });
    expect(r.stdout.trim().split('\n')).toEqual([
      'xray rea|react',
      'xray react |components contexts hooks',
      'xray map --format |txt json csv xml',
      'xray completion |bash fish powershell zsh',
      'xray strategy info re|react rest-api',
      'xray map -p |args: *:dirname:_files -/',
    ]);
  });
});

(fish ? describe : describe.skip)('completion: fish end to end', () => {
  it('completes via complete -C', () => {
    const script = [
      'xray completion fish | source',
      ...LINES.map((l) => `echo ${JSON.stringify(l)}"|"(string join " " (complete -C ${JSON.stringify(l)} | string replace -r '\\t.*' ''))`),
    ].join('\n');
    const r = spawnSync(fish!, ['-N', '-c', script], { cwd: sandbox, env, encoding: 'utf8', timeout: 60_000 });
    expect(r.stdout.trim().split('\n')).toEqual([
      'xray rea|react',
      'xray react |components contexts hooks',
      'xray map --format |csv json txt xml',
      'xray completion |bash fish powershell zsh',
      'xray strategy info re|react rest-api',
    ]);
  });
});
