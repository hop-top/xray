import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../logger';
import { FileReadError } from '../error/types';

// We use require for tree-sitter grammars as they are native modules
const TypeScript = require('tree-sitter-typescript').typescript;
const Python = require('tree-sitter-python');
const JavaScript = require('tree-sitter-javascript');
const Java = require('tree-sitter-java');
const CSharp = require('tree-sitter-c-sharp');
const CPP = require('tree-sitter-cpp');
const C = require('tree-sitter-c');
const Go = require('tree-sitter-go');
const Rust = require('tree-sitter-rust');
const PHP = require('tree-sitter-php');
const Ruby = require('tree-sitter-ruby');
const Bash = require('tree-sitter-bash');
const Swift = require('tree-sitter-swift');
const Kotlin = require('tree-sitter-kotlin');
const Scala = require('tree-sitter-scala');
// const Dart = require('tree-sitter-dart');
// const Lua = require('tree-sitter-lua');
const Elixir = require('tree-sitter-elixir');
const Haskell = require('tree-sitter-haskell');

interface LanguageConfig {
  grammar: any;
  tagsQuery: string;
  importsQuery?: string;
}

const registry: Record<string, LanguageConfig> = {};

// Helper to load queries
function loadQuery(name: string): string {
  const p = path.join(__dirname, 'queries', name);
  if (fs.existsSync(p)) {
    try {
      return fs.readFileSync(p, 'utf-8');
    } catch (err: any) {
      Logger.warn(`Failed to load query file ${name}: ${err.message}`);
      return '';
    }
  }
  return '';
}

// Initialize Registry
// Note: We reuse tagsQuery for importsQuery for now as we added import captures to the same files
registry['.ts'] = { grammar: TypeScript, tagsQuery: loadQuery('typescript.scm'), importsQuery: loadQuery('typescript.scm') };
registry['.tsx'] = { grammar: TypeScript, tagsQuery: loadQuery('typescript.scm'), importsQuery: loadQuery('typescript.scm') };
registry['.js'] = { grammar: JavaScript, tagsQuery: loadQuery('javascript.scm'), importsQuery: loadQuery('javascript.scm') };
registry['.jsx'] = { grammar: JavaScript, tagsQuery: loadQuery('javascript.scm'), importsQuery: loadQuery('javascript.scm') };
registry['.py'] = { grammar: Python, tagsQuery: loadQuery('python.scm'), importsQuery: loadQuery('python.scm') };
registry['.java'] = { grammar: Java, tagsQuery: loadQuery('java.scm'), importsQuery: loadQuery('java.scm') };
registry['.cs'] = { grammar: CSharp, tagsQuery: loadQuery('c_sharp.scm'), importsQuery: loadQuery('c_sharp.scm') };
registry['.cpp'] = { grammar: CPP, tagsQuery: loadQuery('cpp.scm'), importsQuery: loadQuery('cpp.scm') };
registry['.hpp'] = { grammar: CPP, tagsQuery: loadQuery('cpp.scm'), importsQuery: loadQuery('cpp.scm') };
registry['.c'] = { grammar: C, tagsQuery: loadQuery('c.scm'), importsQuery: loadQuery('c.scm') };
registry['.h'] = { grammar: C, tagsQuery: loadQuery('c.scm'), importsQuery: loadQuery('c.scm') };
registry['.go'] = { grammar: Go, tagsQuery: loadQuery('go.scm'), importsQuery: loadQuery('go.scm') };
registry['.rs'] = { grammar: Rust, tagsQuery: loadQuery('rust.scm'), importsQuery: loadQuery('rust.scm') };
registry['.php'] = { grammar: PHP.php, tagsQuery: loadQuery('php.scm'), importsQuery: loadQuery('php.scm') };
registry['.rb'] = { grammar: Ruby, tagsQuery: loadQuery('ruby.scm'), importsQuery: loadQuery('ruby.scm') };
registry['.sh'] = { grammar: Bash, tagsQuery: loadQuery('bash.scm'), importsQuery: loadQuery('bash.scm') };
registry['.bash'] = { grammar: Bash, tagsQuery: loadQuery('bash.scm'), importsQuery: loadQuery('bash.scm') };
registry['.swift'] = { grammar: Swift, tagsQuery: loadQuery('swift.scm'), importsQuery: loadQuery('swift.scm') };
registry['.kt'] = { grammar: Kotlin, tagsQuery: loadQuery('kotlin.scm'), importsQuery: loadQuery('kotlin.scm') };
registry['.scala'] = { grammar: Scala, tagsQuery: loadQuery('scala.scm'), importsQuery: loadQuery('scala.scm') };
// registry['.dart'] = { grammar: Dart, tagsQuery: loadQuery('dart.scm'), importsQuery: loadQuery('dart.scm') };
// registry['.lua'] = { grammar: Lua, tagsQuery: loadQuery('lua.scm'), importsQuery: loadQuery('lua.scm') };
registry['.ex'] = { grammar: Elixir, tagsQuery: loadQuery('elixir.scm'), importsQuery: loadQuery('elixir.scm') };
registry['.exs'] = { grammar: Elixir, tagsQuery: loadQuery('elixir.scm'), importsQuery: loadQuery('elixir.scm') };
registry['.hs'] = { grammar: Haskell, tagsQuery: loadQuery('haskell.scm'), importsQuery: loadQuery('haskell.scm') };

export function getLanguageConfig(ext: string): LanguageConfig | undefined {
  return registry[ext];
}

export function updateLanguageQuery(ext: string, query: string): void {
  const config = registry[ext];
  if (!config) {
    Logger.warn(`Warning: Cannot update query for unknown extension '${ext}'`);
    return;
  }

  if (!looksLikeTreeSitterQuery(query)) {
    Logger.warn(`Warning: Custom query for '${ext}' does not look like a tree-sitter query (no @capture); keeping default.`);
    return;
  }

  config.tagsQuery = query;
}

// Cheap structural sniff: a usable tree-sitter query must contain `@capture`
// patterns outside of string literals. Source files in every supported
// language fail this (a stray `"user@example.com"` is rejected because the
// quoted string is stripped first). We deliberately avoid invoking the native
// Parser.Query constructor for validation: it throws on many malformed inputs
// but segfaults on some pathological ones (e.g. raw Go source), which no JS
// try/catch can recover from.
function looksLikeTreeSitterQuery(query: string): boolean {
  if (!query || query.length === 0) return false;
  const stripped = query
    // Strip line comments — tree-sitter query (`;`), C-style (`//`).
    .replace(/;[^\n]*/g, '')
    .replace(/\/\/[^\n]*/g, '')
    // Strip block comments (covers Go/JS/Java/...).
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Strip quoted strings so embedded `@`s in source files don't count.
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`[^`]*`/g, '``');
  return stripped.includes('(') && /@[a-zA-Z_][\w.]*/.test(stripped);
}
