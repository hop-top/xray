/**
 * Install / remove grammars in the xray-managed dir (see managedDir()).
 * Native builds therefore only happen for grammars the user asks for, and
 * only on an explicit `xray lang add` - never implicitly during a scan.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { childStdio } from '../result-format';
import { LanguagePack, managedDir, resetGrammarCache, getGrammar, getPack, GrammarStatus } from './grammars';

export interface NpmRunResult {
  status: number | null;
  error?: Error;
}
export type NpmRunner = (args: string[], cwd: string) => NpmRunResult;

export const defaultNpmRunner: NpmRunner = (args, cwd) => {
  const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(bin, args, { cwd, stdio: childStdio() });
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

// --save-exact: without it npm rewrites the catalog range to a caret (`^x.y.z`)
// in the managed package.json, so a lost lockfile re-resolves to a newer,
// possibly broken release instead of the pinned one.
export function installCommand(packs: LanguagePack[]): string[] {
  return ['install', '--save-exact', ...NPM_FLAGS, ...packs.map(p => `${p.module}@${p.range}`)];
}

export function removeCommand(packs: LanguagePack[]): string[] {
  return ['uninstall', ...NPM_FLAGS, ...packs.map(p => p.module)];
}

export interface InstallOutcome {
  ok: boolean;
  statuses: GrammarStatus[];
  dir: string;
}

/**
 * Does xray's own tree-sitter accept this loaded grammar? Runs `setLanguage`
 * and a tiny parse for the default grammar and every per-extension variant
 * (e.g. tsx). Never throws; a grammar generated for a newer tree-sitter ABI
 * than xray's runtime supports loads fine but is rejected here.
 */
export function checkGrammar(status: GrammarStatus): GrammarStatus {
  if (!status.ok) return status;
  const pack = getPack(status.language);
  const grammars = [status.grammar];
  for (const key of Object.values(pack?.extensionExports ?? {})) grammars.push(status.moduleExports?.[key]);
  let treeSitter: string | undefined;
  try {
    // Lazy: grammars.ts must stay free of tree-sitter at import time.
    const Parser = require('tree-sitter');
    try { treeSitter = require('tree-sitter/package.json').version; } catch { /* informational */ }
    for (const g of grammars) {
      if (!g) throw new Error('grammar export is empty');
      const parser = new Parser();
      parser.setLanguage(g);
      const tree = parser.parse('x\n');
      if (!tree?.rootNode?.type) throw new Error('parse produced no tree');
    }
  } catch (err: any) {
    const error = String(err?.message ?? err).split('\n')[0];
    return { ...status, ok: false, reason: 'broken', error, check: { ok: false, error, treeSitter } };
  }
  return { ...status, check: { ok: true, treeSitter } };
}

/** Install packs into the managed dir, then verify each loads and works with xray's tree-sitter. */
export function installPacks(packs: LanguagePack[], run: NpmRunner = defaultNpmRunner, dir: string = managedDir()): InstallOutcome {
  ensureManagedProject(dir);
  const r = run(installCommand(packs), dir);
  resetGrammarCache();
  const statuses = packs.map(p => checkGrammar(getGrammar(p.name)));
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
