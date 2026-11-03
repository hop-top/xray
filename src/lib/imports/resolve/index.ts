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

/** Resolves every record of `entries` in place against the scanned `inputs`. */
export function resolveImports(entries: FileImports[], inputs: readonly ResolveInput[]): void {
  const files = new FileSet(inputs);
  const resolvers = new Map<string, Resolver | undefined>();
  for (const entry of entries) {
    if (entry.imports.length === 0) continue;
    if (!resolvers.has(entry.language)) resolvers.set(entry.language, FACTORIES[entry.language]?.(files));
    const resolve = resolvers.get(entry.language);
    if (!resolve) continue;
    entry.imports = entry.imports.map(r => {
      const res = resolve(r, entry);
      return res ? applyResolution(r, res) : r;
    });
  }
}
