import * as fs from 'fs';
import * as path from 'path';

/** Whether `child` is `parent` or inside it (both absolute, resolved). */
export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Realpath of `p`, or of its nearest existing ancestor joined with the
 * rest: symlinks resolved even for a path that does not exist yet.
 */
export function realpathLoose(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(realpathLoose(parent), path.basename(p));
  }
}
