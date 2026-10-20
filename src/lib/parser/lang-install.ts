/**
 * Install / remove grammars in the xray-managed dir (see managedDir()).
 * Native builds therefore only happen for grammars the user asks for, and
 * only on an explicit `xray lang add` - never implicitly during a scan.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { LanguagePack, managedDir, resetGrammarCache, getGrammar, GrammarStatus } from './grammars';

export interface NpmRunResult {
  status: number | null;
  error?: Error;
}
export type NpmRunner = (args: string[], cwd: string) => NpmRunResult;

export const defaultNpmRunner: NpmRunner = (args, cwd) => {
  const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(bin, args, { cwd, stdio: 'inherit' });
  return { status: r.status, error: r.error };
};

function ensureManagedProject(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const pkg = path.join(dir, 'package.json');
  if (!fs.existsSync(pkg)) {
    fs.writeFileSync(pkg, JSON.stringify({ name: 'xray-languages', private: true, description: 'Grammars installed by `xray lang add`' }, null, 2) + '\n');
  }
}

// --legacy-peer-deps: some grammars (e.g. kotlin) peer-depend on an older
// tree-sitter; xray supplies tree-sitter itself, so the peer must not be resolved here.
const NPM_FLAGS = ['--legacy-peer-deps', '--no-audit', '--no-fund', '--prefer-offline'];

export function installCommand(packs: LanguagePack[]): string[] {
  return ['install', ...NPM_FLAGS, ...packs.map(p => `${p.module}@${p.range}`)];
}

export function removeCommand(packs: LanguagePack[]): string[] {
  return ['uninstall', ...NPM_FLAGS, ...packs.map(p => p.module)];
}

export interface InstallOutcome {
  ok: boolean;
  statuses: GrammarStatus[];
  dir: string;
}

/** Install packs into the managed dir, then verify each actually loads. */
export function installPacks(packs: LanguagePack[], run: NpmRunner = defaultNpmRunner, dir: string = managedDir()): InstallOutcome {
  ensureManagedProject(dir);
  const r = run(installCommand(packs), dir);
  resetGrammarCache();
  const statuses = packs.map(p => getGrammar(p.name));
  return { ok: r.status === 0 && !r.error && statuses.every(s => s.ok), statuses, dir };
}

export function removePacks(packs: LanguagePack[], run: NpmRunner = defaultNpmRunner, dir: string = managedDir()): InstallOutcome {
  if (!fs.existsSync(path.join(dir, 'package.json'))) {
    return { ok: true, statuses: packs.map(p => getGrammar(p.name)), dir };
  }
  const r = run(removeCommand(packs), dir);
  resetGrammarCache();
  return { ok: r.status === 0 && !r.error, statuses: packs.map(p => getGrammar(p.name)), dir };
}

/** Is this pack present in the managed dir's package.json? */
export function isManaged(pack: LanguagePack, dir: string = managedDir()): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    return !!pkg.dependencies?.[pack.module];
  } catch {
    return false;
  }
}
