/**
 * Input view for the resolution pass: the scanned file set (posix paths
 * relative to the root) and text access to manifests in it. Nothing outside
 * the set is read: no filesystem, no network, no node_modules.
 */

import * as posix from 'path/posix';
import type { ImportRecord, Locality, Resolved } from '../types';

export interface ResolveInput {
  path: string;
  content: string | Buffer;
}

export class FileSet {
  private readonly contents = new Map<string, string | Buffer>();
  private readonly dirs = new Set<string>();
  private readonly texts = new Map<string, string | undefined>();
  private readonly json = new Map<string, unknown>();

  constructor(files: readonly ResolveInput[]) {
    for (const f of files) {
      this.contents.set(f.path, f.content);
      for (let d = dirOf(f.path); ; d = dirOf(d)) {
        if (this.dirs.has(d)) break;
        this.dirs.add(d);
        if (d === '') break;
      }
    }
  }

  has(file: string): boolean {
    return this.contents.has(file);
  }

  /** A directory holding at least one file of the set ('' = root). */
  hasDir(dir: string): boolean {
    return this.dirs.has(dir);
  }

  paths(): IterableIterator<string> {
    return this.contents.keys();
  }

  text(file: string): string | undefined {
    if (!this.texts.has(file)) {
      const c = this.contents.get(file);
      this.texts.set(file, c === undefined ? undefined : typeof c === 'string' ? c : c.toString('utf8'));
    }
    return this.texts.get(file);
  }

  /** Parsed JSON object, or undefined when absent / invalid / not an object. */
  jsonObject(file: string): Record<string, unknown> | undefined {
    if (!this.json.has(file)) {
      let v: unknown;
      try {
        const t = this.text(file);
        v = t === undefined ? undefined : JSON.parse(t.replace(/^﻿/, ''));
      } catch {
        v = undefined;
      }
      this.json.set(file, v && typeof v === 'object' && !Array.isArray(v) ? v : undefined);
    }
    return this.json.get(file) as Record<string, unknown> | undefined;
  }

  /** Nearest directory at or above `dir` holding `name`, or undefined. */
  nearest(dir: string, name: string): string | undefined {
    for (let d = dir; ; d = dirOf(d)) {
      if (this.has(join(d, name))) return d;
      if (d === '') return undefined;
    }
  }
}

/** Parent directory of a root-relative posix path; '' for the root. */
export function dirOf(p: string): string {
  const d = posix.dirname(p);
  return d === '.' ? '' : d;
}

/** Root-relative posix join ('' = root). */
export function join(dir: string, rel: string): string {
  return dir === '' ? rel : `${dir}/${rel}`;
}

/** Root-relative normalized path, or undefined when it leaves the root. */
export function inRoot(p: string): string | undefined {
  const n = posix.normalize(p);
  if (n === '..' || n.startsWith('../') || n.startsWith('/')) return undefined;
  return n === '.' ? '' : n;
}

export interface Resolution {
  normalized?: string | null;
  package?: string;
  locality?: Locality;
  resolved?: Resolved;
}

/** Contract key order (schemas/xray.imports.v1.json); goldens compare serialized output. */
const KEY_ORDER = [
  'line', 'column', 'endLine', 'endColumn', 'kind', 'form', 'module', 'normalized', 'package', 'locality',
  'relative', 'alias', 'names', 'wildcard', 'typeOnly', 'resolved', 'confidence', 'occurrences', 'evidence',
];
const RANK = new Map(KEY_ORDER.map((k, i) => [k, i]));

/**
 * Record with `res` applied. Keys already present keep their place; a new
 * key goes right before the first existing key that follows it in contract
 * order.
 */
export function applyResolution(r: ImportRecord, res: Resolution): ImportRecord {
  const src = r as unknown as Record<string, unknown>;
  const patch = Object.fromEntries(Object.entries(res).filter(([, v]) => v !== undefined));
  const added = Object.keys(patch).filter(k => !(k in src)).sort((a, b) => RANK.get(a)! - RANK.get(b)!);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src)) {
    const rank = RANK.get(k) ?? Infinity;
    while (added.length > 0 && RANK.get(added[0])! < rank) {
      const a = added.shift()!;
      out[a] = patch[a];
    }
    out[k] = k in patch ? patch[k] : src[k];
  }
  for (const a of added) out[a] = patch[a];
  return out as unknown as ImportRecord;
}
