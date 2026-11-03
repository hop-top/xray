// Unsupported: computed specifiers, eval, a second require.
import { createRequire } from 'node:module';

const name = process.env.PLUGIN ?? 'default';
export const plugin = require(`./plugins/${name}`);
export const later = () => import(name);
const req = createRequire(import.meta.url);
export const code = eval('1 + 1');
export const other = req('x');
