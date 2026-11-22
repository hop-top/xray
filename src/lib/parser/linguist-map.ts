import * as path from 'path';

/**
 * Exact filenames mapped to canonical lowercase language names.
 */
const FILENAME_MAP: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Containerfile: 'dockerfile',
  Makefile: 'makefile',
  GNUmakefile: 'makefile',
  'Makefile.am': 'makefile',
  'Makefile.in': 'makefile',
  'CMakeLists.txt': 'cmake',
  Rakefile: 'ruby',
  Gemfile: 'ruby',
  Vagrantfile: 'ruby',
  Podfile: 'ruby',
  Fastfile: 'ruby',
  Jenkinsfile: 'groovy',
  Justfile: 'just',
  justfile: 'just',
  BUILD: 'starlark',
  'BUILD.bazel': 'starlark',
  WORKSPACE: 'starlark',
  'WORKSPACE.bazel': 'starlark',
  Tiltfile: 'starlark',
  Earthfile: 'earthfile',
  'meson.build': 'meson',
  'meson_options.txt': 'meson',
  SConstruct: 'python',
  SConscript: 'python',
  Procfile: 'procfile',
};

/**
 * File extensions (lowercase, with leading dot) mapped to canonical lowercase
 * language names. Covers 100+ extensions across systems, web, scripting,
 * functional, query/schema, IaC, hardware, and shader languages.
 */
const EXTENSION_MAP: Record<string, string> = {
  // Systems & compiled
  '.zig': 'zig',
  '.nim': 'nim',
  '.nims': 'nim',
  '.d': 'd',
  '.di': 'd',
  '.v': 'v',
  '.odin': 'odin',
  '.cr': 'crystal',
  '.ada': 'ada',
  '.adb': 'ada',
  '.ads': 'ada',
  '.f': 'fortran',
  '.f90': 'fortran',
  '.f95': 'fortran',
  '.f03': 'fortran',
  '.f08': 'fortran',
  '.for': 'fortran',
  '.cob': 'cobol',
  '.cbl': 'cobol',
  '.pas': 'pascal',
  '.pp': 'pascal',
  '.asm': 'assembly',
  '.s': 'assembly',
  '.mojo': 'mojo',
  '.gleam': 'gleam',
  '.roc': 'roc',
  '.cu': 'cuda',
  '.cuh': 'cuda',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hh': 'cpp',
  '.hxx': 'cpp',

  // Mobile / JVM / .NET
  '.dart': 'dart',
  '.groovy': 'groovy',
  '.gradle': 'groovy',
  '.gvy': 'groovy',
  '.kts': 'kotlin',
  '.vb': 'vbnet',
  '.vbs': 'vbscript',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.fsi': 'fsharp',
  '.m': 'objectivec',
  '.mm': 'objectivec',
  '.hx': 'haxe',
  '.vala': 'vala',
  '.vapi': 'vala',

  // Functional / Lisp / BEAM
  '.clj': 'clojure',
  '.cljs': 'clojurescript',
  '.cljc': 'clojure',
  '.edn': 'clojure',
  '.erl': 'erlang',
  '.hrl': 'erlang',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.elm': 'elm',
  '.purs': 'purescript',
  '.idr': 'idris',
  '.agda': 'agda',
  '.lean': 'lean',
  '.rkt': 'racket',
  '.scm': 'scheme',
  '.ss': 'scheme',
  '.lisp': 'commonlisp',
  '.lsp': 'commonlisp',
  '.cl': 'commonlisp',
  '.el': 'elisp',
  '.lhs': 'haskell',

  // Scripting / Shell / Dynamic
  '.lua': 'lua',
  '.r': 'r',
  '.rmd': 'r',
  '.jl': 'julia',
  '.pl': 'perl',
  '.pm': 'perl',
  '.t': 'perl',
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.zsh': 'zsh',
  '.fish': 'fish',
  '.ksh': 'ksh',
  '.csh': 'csh',
  '.tcsh': 'tcsh',
  '.awk': 'awk',
  '.sed': 'sed',
  '.tcl': 'tcl',
  '.tk': 'tcl',
  '.bat': 'batch',
  '.cmd': 'batch',
  '.coffee': 'coffeescript',
  '.litcoffee': 'coffeescript',
  '.ls': 'livescript',
  '.pyx': 'cython',
  '.pxd': 'cython',
  '.pxi': 'cython',

  // Web / Frontend / Templates
  '.svelte': 'svelte',
  '.vue': 'vue',
  '.astro': 'astro',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.styl': 'stylus',
  '.pug': 'pug',
  '.jade': 'pug',
  '.hbs': 'handlebars',
  '.ejs': 'ejs',
  '.njk': 'nunjucks',
  '.liquid': 'liquid',
  '.twig': 'twig',
  '.erb': 'erb',
  '.haml': 'haml',
  '.slim': 'slim',

  // Data / Query / Schema / IDL
  '.sql': 'sql',
  '.psql': 'sql',
  '.plsql': 'sql',
  '.proto': 'protobuf',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.prisma': 'prisma',
  '.thrift': 'thrift',
  '.capnp': 'capnp',
  '.fbs': 'flatbuffers',
  '.avsc': 'avro',
  '.yang': 'yang',
  '.smithy': 'smithy',
  '.jq': 'jq',

  // IaC / Config / Policy / Build
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  '.hcl': 'hcl',
  '.nix': 'nix',
  '.dhall': 'dhall',
  '.cue': 'cue',
  '.rego': 'rego',
  '.pkl': 'pkl',
  '.jsonnet': 'jsonnet',
  '.libsonnet': 'jsonnet',
  '.cmake': 'cmake',
  '.bzl': 'starlark',
  '.star': 'starlark',
  '.dockerfile': 'dockerfile',
  '.mk': 'makefile',
  '.mak': 'makefile',

  // Smart contracts / Shaders / Hardware
  '.sol': 'solidity',
  '.move': 'move',
  '.cairo': 'cairo',
  '.wgsl': 'wgsl',
  '.glsl': 'glsl',
  '.hlsl': 'hlsl',
  '.vert': 'glsl',
  '.frag': 'glsl',
  '.comp': 'glsl',
  '.geom': 'glsl',
  '.sv': 'systemverilog',
  '.svh': 'systemverilog',
  '.vhd': 'vhdl',
  '.vhdl': 'vhdl',
};

/**
 * Detect canonical lowercase language name from a relative path's filename or extension.
 */
export function detectLanguage(relPath: string): string | null {
  const base = path.basename(relPath);
  if (Object.prototype.hasOwnProperty.call(FILENAME_MAP, base)) {
    return FILENAME_MAP[base];
  }
  const ext = path.extname(base).toLowerCase();
  if (ext && Object.prototype.hasOwnProperty.call(EXTENSION_MAP, ext)) {
    return EXTENSION_MAP[ext];
  }
  return null;
}

/**
 * Return all file extensions covered by the Linguist fallback map.
 */
export function linguistExtensions(): string[] {
  return Object.keys(EXTENSION_MAP);
}

/**
 * Whether `relPath` is a supported fallback file (by exact filename or extension).
 */
export function isSupportedFallbackFile(relPath: string): boolean {
  return detectLanguage(relPath) !== null;
}
