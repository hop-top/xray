// Calls at any depth; template literal without substitution is literal.
function load() {
  if (process.env.DEBUG) {
    return [require(`./debug.js`), require('node:fs/promises')];
  }
  return wrap(async () => (await import(`@scope/pkg/sub`)).default);
}

// Not literal: substitution, concatenation, escape sequence.
require(`./${load.name}.js`);
import('./a' + '.js');
require('./b\x2ejs');

// Not imports: member callee, no argument.
require.resolve('not-an-import');
module.require;
require();

// Ambient-style read, not a binding.
if (typeof require === 'function') require('still-global');
