import express, { Router } from 'express';
import * as util from 'node:util';
export { helper } from './helper.js';
export * from './all.js';
const cjs = require('cjs-only'); // call form: not a static import
const lazy = () => import('./lazy.js'); // call form: not a static import
