const fs = require('fs');
const plugin = require(`./plugins/${name}`);

async function load(lang) {
  const messages = await import('./i18n/' + lang + '.js');
  return messages;
}

eval(code);
const add = new Function('a', 'b', 'return a + b');
