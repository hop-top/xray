/**
 * Contract languages: one flat entry per language (registry key = the
 * `language` written to each file entry). `pack` names the grammar pack in
 * parser/grammars.ts; `extensions` is the contract extension map (it may
 * list extensions the scanner's packs do not, e.g. `.mjs`); the grammar per
 * extension comes from grammarForExtension (`.tsx` -> tsx grammar).
 */

import type { LanguageExtractor } from './record';
import { extractEcmaScript } from './lang/ecmascript';
import { extractGo } from './lang/go';
import { extractPhp } from './lang/php';
import { extractPython } from './lang/python';
import { extractRust } from './lang/rust';

export interface ImportLanguage {
  pack: string;
  extensions: readonly string[];
  extract: LanguageExtractor;
}

export const IMPORT_LANGUAGES: Record<string, ImportLanguage> = {
  go: { pack: 'go', extensions: ['.go'], extract: extractGo },
  javascript: { pack: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], extract: extractEcmaScript },
  php: { pack: 'php', extensions: ['.php'], extract: extractPhp },
  python: { pack: 'python', extensions: ['.py'], extract: extractPython },
  rust: { pack: 'rust', extensions: ['.rs'], extract: extractRust },
  typescript: { pack: 'typescript', extensions: ['.ts', '.tsx', '.mts', '.cts'], extract: extractEcmaScript },
};

/** Registry key for a file extension (with dot), or undefined. */
export function importLanguageFor(ext: string): string | undefined {
  for (const [lang, l] of Object.entries(IMPORT_LANGUAGES)) if (l.extensions.includes(ext)) return lang;
  return undefined;
}
