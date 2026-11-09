/**
 * Builtin / global receivers per language: a member or scoped call whose
 * receiver chain starts at one of these (`JSON.parse`, `fmt.Println`,
 * `std::fs::read`, `System.out.println`) can never reach a user definition,
 * so it records no reference. Data only; consumed through CallShape.builtins.
 */
export interface BuiltinReceivers {
  /** Root identifiers of a receiver / scope chain (`JSON`, `System`, `std`). */
  names?: readonly string[];
  /** Import sources whose bound name is a builtin (stdlib modules / packages). */
  imports?: (source: string) => boolean;
  /** Matched against the whole qualifier text (PHP `\DateTime`). */
  qualifier?: RegExp;
}

const JS: BuiltinReceivers = {
  names: [
    'JSON', 'Math', 'Object', 'Array', 'Promise', 'console', 'Number', 'String', 'Boolean', 'Date',
    'Reflect', 'Symbol', 'process', 'Buffer', 'globalThis', 'window', 'document', 'Intl', 'Error',
    'Map', 'Set', 'WeakMap', 'RegExp', 'BigInt', 'Atomics',
  ],
};

/** Python builtin types used as receivers (`str.join`, `dict.fromkeys`). */
const PYTHON_BUILTINS = [
  'str', 'bytes', 'bytearray', 'int', 'float', 'complex', 'bool', 'dict', 'list', 'set', 'frozenset',
  'tuple', 'object', 'type', 'range', 'memoryview',
];

/**
 * Top-level Python stdlib modules: CPython 3.14 `sys.stdlib_module_names`
 * (public names) plus modules removed since 3.9.
 */
const PYTHON_STDLIB = new Set([
  'abc', 'annotationlib', 'antigravity', 'argparse', 'array', 'ast', 'asyncio', 'atexit', 'base64',
  'bdb', 'binascii', 'bisect', 'builtins', 'bz2', 'cProfile', 'calendar', 'cmath', 'cmd', 'code',
  'codecs', 'codeop', 'collections', 'colorsys', 'compileall', 'compression', 'concurrent',
  'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg', 'csv', 'ctypes', 'curses',
  'dataclasses', 'datetime', 'dbm', 'decimal', 'difflib', 'dis', 'doctest', 'email', 'encodings',
  'ensurepip', 'enum', 'errno', 'faulthandler', 'fcntl', 'filecmp', 'fileinput', 'fnmatch',
  'fractions', 'ftplib', 'functools', 'gc', 'genericpath', 'getopt', 'getpass', 'gettext', 'glob',
  'graphlib', 'grp', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'idlelib', 'imaplib',
  'importlib', 'inspect', 'io', 'ipaddress', 'itertools', 'json', 'keyword', 'linecache', 'locale',
  'logging', 'lzma', 'mailbox', 'marshal', 'math', 'mimetypes', 'mmap', 'modulefinder', 'msvcrt',
  'multiprocessing', 'netrc', 'nt', 'ntpath', 'nturl2path', 'numbers', 'opcode', 'operator',
  'optparse', 'os', 'pathlib', 'pdb', 'pickle', 'pickletools', 'pkgutil', 'platform', 'plistlib',
  'poplib', 'posix', 'posixpath', 'pprint', 'profile', 'pstats', 'pty', 'pwd', 'py_compile',
  'pyclbr', 'pydoc', 'pydoc_data', 'pyexpat', 'queue', 'quopri', 'random', 're', 'readline',
  'reprlib', 'resource', 'rlcompleter', 'runpy', 'sched', 'secrets', 'select', 'selectors', 'shelve',
  'shlex', 'shutil', 'signal', 'site', 'smtplib', 'socket', 'socketserver', 'sqlite3', 'sre_compile',
  'sre_constants', 'sre_parse', 'ssl', 'stat', 'statistics', 'string', 'stringprep', 'struct',
  'subprocess', 'symtable', 'sys', 'sysconfig', 'syslog', 'tabnanny', 'tarfile', 'tempfile',
  'termios', 'textwrap', 'this', 'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize',
  'tomllib', 'trace', 'traceback', 'tracemalloc', 'tty', 'turtle', 'turtledemo', 'types', 'typing',
  'unicodedata', 'unittest', 'urllib', 'uuid', 'venv', 'warnings', 'wave', 'weakref', 'webbrowser',
  'winreg', 'winsound', 'wsgiref', 'xml', 'xmlrpc', 'zipapp', 'zipfile', 'zipimport', 'zlib',
  'zoneinfo',
  // Removed in 3.10-3.13.
  'asynchat', 'asyncore', 'audioop', 'cgi', 'cgitb', 'chunk', 'crypt', 'distutils', 'imghdr', 'imp',
  'lib2to3', 'mailcap', 'msilib', 'nis', 'nntplib', 'ossaudiodev', 'pipes', 'smtpd', 'sndhdr', 'spwd',
  'sunau', 'telnetlib', 'uu', 'xdrlib',
]);

/**
 * First segment of every Go standard-library import path. Std paths never
 * have a dot in the first segment; requiring a known segment as well keeps
 * dot-less module paths (`module myapp`) out.
 */
const GO_STD_ROOTS = new Set([
  'archive', 'bufio', 'builtin', 'bytes', 'cmp', 'compress', 'container', 'context', 'crypto',
  'database', 'debug', 'embed', 'encoding', 'errors', 'expvar', 'flag', 'fmt', 'go', 'hash', 'html',
  'image', 'index', 'io', 'iter', 'log', 'maps', 'math', 'mime', 'net', 'os', 'path', 'plugin',
  'reflect', 'regexp', 'runtime', 'slices', 'sort', 'strconv', 'strings', 'structs', 'sync',
  'syscall', 'testing', 'text', 'time', 'unicode', 'unique', 'unsafe', 'weak', 'C',
]);

export const BUILTIN_RECEIVERS: Record<string, BuiltinReceivers> = {
  typescript: JS,
  javascript: JS,
  python: {
    names: PYTHON_BUILTINS,
    imports: source => !source.startsWith('.') && PYTHON_STDLIB.has(source.split('.')[0]),
  },
  go: {
    imports: source => {
      const first = source.split('/')[0];
      return !first.includes('.') && GO_STD_ROOTS.has(first);
    },
  },
  java: {
    names: [
      'System', 'Math', 'String', 'Objects', 'Arrays', 'Collections', 'Integer', 'Long', 'Double',
      'Boolean', 'Character', 'Optional', 'Stream', 'Collectors', 'Thread', 'Files', 'Paths',
      'List', 'Map', 'Set', 'UUID',
    ],
  },
  csharp: {
    names: [
      'System', 'Console', 'Math', 'String', 'Convert', 'Enumerable', 'Task', 'File', 'Path',
      'Directory', 'Environment', 'Guid', 'DateTime', 'Array',
    ],
  },
  // `\DateTime::now()`: a fully-qualified class in the global namespace.
  // `self::` / `static::` / `parent::` stay (they name user classes).
  php: { qualifier: /^\\[A-Za-z_][A-Za-z0-9_]*$/ },
  rust: { names: ['std', 'core', 'alloc', 'String', 'Vec', 'Box', 'Option', 'Result'] },
  cpp: { names: ['std'] },
  ruby: {
    names: [
      'Kernel', 'Math', 'File', 'Dir', 'FileUtils', 'IO', 'JSON', 'YAML', 'Time', 'Process', 'ENV',
      'Integer', 'Float', 'String', 'Array', 'Hash',
    ],
  },
  kotlin: {
    names: [
      'System', 'Math', 'String', 'Integer', 'Long', 'Double', 'Arrays', 'Collections', 'Objects',
      'Thread', 'Runtime',
    ],
  },
  swift: {
    names: [
      'Swift', 'DispatchQueue', 'FileManager', 'NotificationCenter', 'UserDefaults', 'Bundle',
      'ProcessInfo', 'JSONSerialization', 'Thread', 'Date', 'String', 'Int', 'Double', 'Array',
      'Dictionary', 'Set',
    ],
  },
  scala: {
    names: [
      'scala', 'java', 'math', 'Math', 'System', 'Console', 'Predef', 'Option', 'Some', 'List', 'Seq',
      'Vector', 'Map', 'Set', 'Future', 'Await', 'String', 'Integer',
    ],
  },
};
