import * as path from 'path';
import { isWithin, realpathLoose } from './confine';
import { UsageError } from './error/types';
import { terminalSafe } from './terminal-safe';

/** Workspace-local directory for all xray-generated artifacts. */
export const XRAY_DIR = '.xray';

/** Subdirectories under `<root>/.xray/` by artifact kind. */
export type XrayWorkspaceSubdir = 'maps' | 'graphs' | 'handbook' | 'skills' | 'strategies';

/** Resolve `<root>/.xray/<subdir>` as an absolute path. */
export function xrayWorkspaceDir(root: string, subdir: XrayWorkspaceSubdir): string {
  return path.resolve(root, XRAY_DIR, subdir);
}

/**
 * Refuse default workspace writes when `.xray` or `<subdir>` is a symlink
 * resolving outside `root`. Explicit user flags (`-o/--output`, `--dir`)
 * bypass this check.
 */
export function assertDefaultOutputConfined(
  targetDir: string,
  root: string,
  flagHint = '-o/--output'
): void {
  const realRoot = realpathLoose(path.resolve(root));
  const realTarget = realpathLoose(path.resolve(targetDir));
  if (!isWithin(realRoot, realTarget)) {
    throw new UsageError(
      `refusing to write: ${terminalSafe(targetDir)} resolves to ${terminalSafe(realTarget)}, outside the project ` +
      `${terminalSafe(realRoot)} (a symlink in .xray?); pass ${flagHint} to choose a path`
    );
  }
}

/**
 * Default output base path for `map` or `graph` when `-o/--output` is omitted:
 * `<cwd>/.xray/maps/map` or `<cwd>/.xray/graphs/graph`.
 */
export function defaultOutputBase(kind: 'map' | 'graph', cwd: string = process.cwd()): string {
  const subdir: XrayWorkspaceSubdir = kind === 'graph' ? 'graphs' : 'maps';
  const dir = xrayWorkspaceDir(cwd, subdir);
  assertDefaultOutputConfined(dir, cwd);
  return path.join(dir, kind);
}
