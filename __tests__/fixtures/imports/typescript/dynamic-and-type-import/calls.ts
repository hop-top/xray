import fs = require('fs');
const lazy = () => import('./lazy');
const cfg = require('./config.json');

type Foo = import('./types').Foo;
let q: typeof import('./query');
function make(): import('./model').Model {
  return null as unknown as import('./cast').Cast;
}
interface Holder { item: import('./item').Item }

export async function run(spec: string) {
  await import(spec);
  return import(`./plugins/core`);
}
