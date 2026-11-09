/**
 * Resolution pass: fills `locality`, `package`, `normalized` (where only
 * resolution can derive it) and `resolved` on extracted records.
 *
 * Inputs are the extracted file entries and the full scanned file set
 * (manifests included: go.mod, go.work, package.json; Cargo.toml and
 * `__init__.py` only as markers). Nothing outside the set is read. Works on
 * record fields (`kind`, `form`, `module`, `normalized`, `relative`), so
 * every record kind goes through the same rules. A resolver returning
 * nothing leaves the record as extracted.
 */

import { Logger } from '../../logger';
import type { FileImports, ImportRecord } from '../types';
import { applyResolution, FileSet, type ResolveInput, type Resolution } from './context';
import { ecmascriptResolver } from './ecmascript';
import { goResolver } from './go';
import { phpResolver } from './php';
import { pythonResolver } from './python';
import { rustResolver } from './rust';

export type { ResolveInput, Resolution } from './context';

type Resolver = (r: ImportRecord, f: FileImports) => Resolution | undefined;

const byPath = (fn: (r: ImportRecord, file: string) => Resolution | undefined): Resolver => (r, f) => fn(r, f.path);

const FACTORIES: Record<string, (files: FileSet) => Resolver> = {
  go: files => byPath(goResolver(files)),
  javascript: files => byPath(ecmascriptResolver(files)),
  php: files => byPath(phpResolver(files)),
  python: files => byPath(pythonResolver(files)),
  rust: files => rustResolver(files),
  typescript: files => byPath(ecmascriptResolver(files)),
};

const FAILED = Symbol('resolver-failed');

/**
 * Resolves every record of `entries` in place against the scanned `inputs`.
 *
 * Per-file isolation: an exception from a resolver (or its factory) leaves
 * that file's records exactly as extracted (no `resolved`, no
 * resolution-derived locality) and sets `complete: false`; no unsupported
 * record (no construct describes it) and nothing of the failure goes into
 * the document, only a debug line naming the file. Other files resolve.
 */
export function resolveImports(entries: FileImports[], inputs: readonly ResolveInput[]): void {
  const files = new FileSet(inputs);
  const resolvers = new Map<string, Resolver | typeof FAILED | undefined>();
  for (const entry of entries) {
    if (entry.imports.length === 0) continue;
    if (!resolvers.has(entry.language)) {
      let made: Resolver | typeof FAILED | undefined;
      try {
        made = FACTORIES[entry.language]?.(files);
      } catch (err) {
        Logger.debug(`imports: resolver setup failed for ${entry.language} (${errName(err)})`);
        made = FAILED;
      }
      resolvers.set(entry.language, made);
    }
    const resolve = resolvers.get(entry.language);
    if (!resolve) continue;
    if (resolve === FAILED) {
      unresolved(entry);
      continue;
    }
    // Truncated records (capModules) name no real module: left as extracted.
    const capped = new Set(entry.unsupported.filter(u => u.construct === 'oversized-module').map(u => `${u.line}:${u.column}`));
    try {
      entry.imports = entry.imports.map(r => {
        if (capped.size > 0 && capped.has(`${r.line}:${r.column}`)) return r;
        const res = resolve(r, entry);
        return res ? applyResolution(r, res) : r;
      });
    } catch (err) {
      // map() never assigned: entry.imports still holds the extracted records.
      Logger.debug(`imports: resolution failed for ${entry.path} (${errName(err)})`);
      unresolved(entry);
    }
  }
}

function unresolved(entry: FileImports): void {
  entry.complete = false;
}

const errName = (err: unknown) => (err instanceof Error ? err.name : typeof err);
