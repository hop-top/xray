/**
 * Every usage error renders through one path: `✖ <message>` on stderr,
 * exit 2. Commander-raised errors (bad flag, missing argument, unknown
 * help topic) used to print kit's plain `error: ...` instead.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const BIN = path.join(__dirname, '..', '..', 'bin', 'xray');

function run(args: string[]): { stderr: string; status: number | null } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-usage-'));
  try {
    const r = spawnSync('node', [BIN, ...args], {
      encoding: 'utf8',
      cwd: home,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, 'c'),
        XDG_CACHE_HOME: path.join(home, 'k'),
        NO_COLOR: '1',
      },
    });
    return { stderr: r.stderr, status: r.status };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

describe('usage error rendering', () => {
  const cases: Array<[string, string[], RegExp]> = [
    ['unknown flag', ['map', '--bogus'], /unknown option '--bogus'/],
    ['missing flag value', ['map', '--log-level'], /argument missing/],
    ['missing argument', ['alias', 'remove'], /missing required argument 'name'/],
    ['unknown help topic', ['help', 'nosuch'], /unknown help topic 'nosuch'/],
    ['unsupported shell', ['completion', 'pwsh'], /unsupported shell 'pwsh'/],
    ['unknown command', ['nosuchcmd-x'], /unknown command 'nosuchcmd-x'/],
  ];

  it.each(cases)('%s: exit 2, first line is "✖ <msg>"', (_n, args, msg) => {
    const r = run(args);
    expect(r.status).toBe(2);
    const first = r.stderr.split('\n')[0];
    expect(first.startsWith('✖ ')).toBe(true);
    expect(first).toMatch(msg);
    expect(r.stderr).not.toMatch(/^error: /m);
  });
});
