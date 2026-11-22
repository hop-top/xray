import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { loadConfig } from '../config';
import { isWithin, realpathLoose } from '../confine';
import { UsageError } from '../error/types';

export const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-_]*$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export interface SkillMeta {
  slug: string;
  name: string;
  description: string;
  triggers?: string[];
  path: string;
}

export interface SkillDocument extends SkillMeta {
  body: string;
  raw: string;
}

export interface SkillRegistryOptions {
  configPath?: string;
  dirs?: string[];
}

function validateSlug(slug: string): string {
  if (!slug || !SKILL_SLUG_RE.test(slug)) {
    throw new UsageError(`Invalid skill slug '${slug}'`);
  }
  return slug;
}

function parseSkillFile(slug: string, relPath: string, raw: string): SkillDocument {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return {
      slug,
      name: slug,
      description: '',
      path: relPath,
      body: raw.trim(),
      raw,
    };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UsageError(`Invalid YAML frontmatter in skill '${slug}': ${msg}`);
  }

  const record =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  const name =
    typeof record.name === 'string' && record.name.trim().length > 0
      ? record.name.trim()
      : slug;
  const description =
    typeof record.description === 'string' ? record.description.trim() : '';

  let triggers: string[] | undefined;
  if (Array.isArray(record.triggers)) {
    const cleaned = record.triggers
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (cleaned.length > 0) {
      triggers = cleaned;
    }
  }

  const body = raw.slice(match[0].length).replace(/^\r?\n+/, '').trim();
  return {
    slug,
    name,
    description,
    ...(triggers ? { triggers } : {}),
    path: relPath,
    body,
    raw,
  };
}

/**
 * Discovers and reads workspace skills from `.xray/skills/<slug>/SKILL.md`
 * and `.xrayrc.json#skills.dirs`, confining every directory to the project root.
 */
export class SkillRegistry {
  private readonly realRoot: string;
  private readonly configPath?: string;
  private readonly extraDirs?: string[];

  constructor(root: string, options: SkillRegistryOptions = {}) {
    this.realRoot = realpathLoose(path.resolve(root));
    this.configPath = options.configPath;
    this.extraDirs = options.dirs;
  }

  private resolveConfinedDirs(): string[] {
    const config = loadConfig(this.configPath, this.realRoot);
    const configuredDirs = config?.skills?.dirs ?? [];
    const candidates = [
      path.join('.xray', 'skills'),
      ...(Array.isArray(configuredDirs) ? configuredDirs : []),
      ...(this.extraDirs ?? []),
    ];

    const seen = new Set<string>();
    const dirs: string[] = [];

    for (const rawDir of candidates) {
      if (typeof rawDir !== 'string' || !rawDir.trim()) continue;
      const resolved = path.isAbsolute(rawDir)
        ? rawDir
        : path.resolve(this.realRoot, rawDir);
      const realDir = realpathLoose(resolved);
      if (!isWithin(this.realRoot, realDir)) {
        throw new UsageError(`Skill directory '${rawDir}' escapes project root`);
      }
      if (!seen.has(realDir)) {
        seen.add(realDir);
        dirs.push(realDir);
      }
    }

    return dirs;
  }

  private readSkillFromDir(dir: string, slug: string): SkillDocument | null {
    const skillDir = path.join(dir, slug);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) return null;

    const realFile = realpathLoose(skillFile);
    if (!isWithin(this.realRoot, realFile)) {
      throw new UsageError(`Skill '${slug}' escapes project root`);
    }

    const stat = fs.statSync(realFile);
    if (!stat.isFile()) return null;

    const raw = fs.readFileSync(realFile, 'utf-8');
    const relPath = path.relative(this.realRoot, realFile).split(path.sep).join('/');
    return parseSkillFile(slug, relPath, raw);
  }

  /** List all valid discovered skills sorted by slug. */
  list(): SkillMeta[] {
    const dirs = this.resolveConfinedDirs();
    const bySlug = new Map<string, SkillMeta>();

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!SKILL_SLUG_RE.test(entry.name)) continue;
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (bySlug.has(entry.name)) continue;

        const doc = this.readSkillFromDir(dir, entry.name);
        if (!doc) continue;

        const { body: _body, raw: _raw, ...meta } = doc;
        bySlug.set(doc.slug, meta);
      }
    }

    return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /** Read a single skill by slug, returning null when not found. */
  read(slug: string): SkillDocument | null {
    const clean = validateSlug(slug);
    const dirs = this.resolveConfinedDirs();

    for (const dir of dirs) {
      const doc = this.readSkillFromDir(dir, clean);
      if (doc) return doc;
    }

    return null;
  }
}
