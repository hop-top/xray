/**
 * resolvePreset — dispatch `--preset <spec>` to a built-in, local
 * file, or npm package, in that order.
 *
 * Resolution heuristic (strict, spec C-3):
 *
 *   1. Bare name matching a built-in → built-ins ALWAYS win. An
 *      installed `xray-preset-insights` package cannot shadow the
 *      built-in `insights` via the unprefixed bare name. Users who
 *      want the package must use a prefixed form.
 *   2. Relative/absolute path (starts with `./`, `../`, or is
 *      absolute per `path.isAbsolute`) → dynamic import against the
 *      current working directory.
 *   3. Package form (starts with `@` or contains a `/`) → dynamic
 *      import of the npm specifier as-is. Node's resolver handles
 *      ESM/CJS interop.
 *   4. Anything else → throw with the built-in catalog listed in the
 *      error message so the user sees a useful diagnostic.
 *
 * Module shape: the imported module MUST expose a `default` export OR
 * at least one named export that is a function (the `Preset`
 * signature). We try `module.default` first, then walk named exports
 * and pick the first function. Rejection is loud — typed error with
 * the resolved module path.
 *
 * Loading: xray ships as CommonJS, where TypeScript compiles `import()`
 * to `require()`. `require` takes filesystem paths and package names, not
 * `file://` URLs, so presets are loaded with `require` directly. Package
 * specs resolve from the working directory (not from xray's own install
 * location). ESM presets (`.mjs`, `"type": "module"`) load through
 * `require(esm)` (Node >= 22.12, the supported floor); an ESM preset with
 * top-level `await` cannot be loaded this way.
 */

import * as path from 'path';
import { createRequire } from 'module';
import type { Preset } from './types';
import { BUILTIN_PRESETS, BUILTIN_PRESET_NAMES } from './index';
import { CodedError, EXIT_NOT_FOUND, EXIT_USAGE } from '../../error/types';
import { nearestMatch } from '../../did-you-mean';

/**
 * Why a `--preset` spec failed. `not-found`: the named path or package
 * does not exist (exit 3). `usage`: unknown built-in name, empty spec, or
 * a module that exists but throws or has the wrong shape (exit 2).
 */
export type PresetFailure = 'usage' | 'not-found';

export class PresetResolutionError extends CodedError {
  constructor(
    message: string,
    public readonly spec: string,
    public readonly resolvedPath?: string,
    failure: PresetFailure = 'usage'
  ) {
    super(
      message,
      failure === 'not-found' ? EXIT_NOT_FOUND : EXIT_USAGE,
      failure === 'not-found' ? 'NOT_FOUND' : 'USAGE'
    );
    this.name = 'PresetResolutionError';
  }
}

function isBuiltin(spec: string): spec is keyof typeof BUILTIN_PRESETS {
  return Object.prototype.hasOwnProperty.call(BUILTIN_PRESETS, spec);
}

function looksLikePath(spec: string): boolean {
  return (
    spec.startsWith('./') ||
    spec.startsWith('../') ||
    path.isAbsolute(spec)
  );
}

function looksLikePackage(spec: string): boolean {
  return spec.startsWith('@') || spec.includes('/');
}

function extractPreset(mod: unknown, resolvedPath: string, spec: string): Preset {
  // CJS `module.exports = fn`: the module itself is the preset.
  if (typeof mod === 'function') {
    return mod as Preset;
  }
  if (mod === null || typeof mod !== 'object') {
    throw new PresetResolutionError(
      `Preset module "${spec}" at ${resolvedPath} exported no usable value. ` +
        `Expected a default export (or named export) that is a function matching the Preset signature.`,
      spec,
      resolvedPath
    );
  }

  const record = mod as Record<string, unknown>;
  // Prefer default export (ESM `export default`, interop'd CJS).
  if (typeof record.default === 'function') {
    return record.default as Preset;
  }
  // Nested default (CJS interop when the module already has `default` wrapped).
  if (
    record.default &&
    typeof record.default === 'object' &&
    typeof (record.default as Record<string, unknown>).default === 'function'
  ) {
    return (record.default as Record<string, unknown>).default as Preset;
  }
  // Named exports: first function wins.
  for (const [key, value] of Object.entries(record)) {
    if (key === 'default') continue;
    if (typeof value === 'function') {
      return value as Preset;
    }
  }
  throw new PresetResolutionError(
    `Preset module "${spec}" at ${resolvedPath} does not export a function. ` +
      `Found keys: [${Object.keys(record).join(', ')}]. ` +
      `Expected a default export that is a function matching the Preset signature.`,
    spec,
    resolvedPath
  );
}

export async function resolvePreset(spec: string): Promise<Preset> {
  if (typeof spec !== 'string' || spec.length === 0) {
    throw new PresetResolutionError(
      `Preset spec must be a non-empty string (got ${typeof spec}).`,
      String(spec)
    );
  }

  // 1. Built-ins win for bare names.
  if (isBuiltin(spec)) {
    return BUILTIN_PRESETS[spec];
  }

  // 2. Local path, resolved against the working directory.
  if (looksLikePath(spec)) {
    const resolvedPath = path.isAbsolute(spec)
      ? spec
      : path.resolve(process.cwd(), spec);
    try {
      require.resolve(resolvedPath);
    } catch {
      throw new PresetResolutionError(
        `Preset "${spec}" not found (resolved to ${resolvedPath}).`,
        spec,
        resolvedPath,
        'not-found'
      );
    }
    let mod: unknown;
    try {
      mod = require(resolvedPath);
    } catch (err) {
      throw new PresetResolutionError(
        `Failed to load preset from "${spec}" (resolved to ${resolvedPath}): ` +
          `${(err as Error).message}`,
        spec,
        resolvedPath
      );
    }
    return extractPreset(mod, resolvedPath, spec);
  }

  // 3. Package form, resolved from the working directory.
  if (looksLikePackage(spec)) {
    const req = createRequire(path.join(process.cwd(), 'noop.js'));
    try {
      req.resolve(spec);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
        throw new PresetResolutionError(
          `Preset npm package "${spec}" not found (resolved from ${process.cwd()}).`,
          spec,
          spec,
          'not-found'
        );
      }
    }
    let mod: unknown;
    try {
      mod = req(spec);
    } catch (err) {
      throw new PresetResolutionError(
        `Failed to load preset from npm package "${spec}": ${(err as Error).message}`,
        spec,
        spec
      );
    }
    return extractPreset(mod, spec, spec);
  }

  // 4. Bogus bare name.
  throw unknownPresetError(spec);
}

function unknownPresetError(spec: string): PresetResolutionError {
  const near = nearestMatch(spec, [...BUILTIN_PRESET_NAMES]);
  const hint = near ? ` (did you mean '${near}'?)` : '';
  return new PresetResolutionError(
    `Unknown preset "${spec}"${hint}. Built-ins: ${BUILTIN_PRESET_NAMES.join(', ')}. ` +
      `For custom presets use a prefixed form: ./relative/path.js, /absolute/path.js, or @scope/pkg.`,
    spec
  );
}

/**
 * Cheap pre-flight for `--preset` specs: rejects an empty spec or an
 * unknown bare name without loading any module code. Path and package
 * specs pass; `resolvePreset` is what loads (and can fail on) them.
 */
export function assertPresetSpec(spec: string): void {
  if (typeof spec !== 'string' || spec.length === 0) {
    throw new PresetResolutionError(
      `Preset spec must be a non-empty string (got ${typeof spec}).`,
      String(spec)
    );
  }
  if (!isBuiltin(spec) && !looksLikePath(spec) && !looksLikePackage(spec)) {
    throw unknownPresetError(spec);
  }
}
