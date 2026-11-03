// Static forms: default, named, namespace, side-effect, type-only, re-exports.
import React from 'react';
import { Button as Btn, type Theme } from '@scope/ui/button';
import * as path from 'node:path';
import './polyfill';
import type { Config } from './config';
export { util } from './util';
export * from './lazy';
import fs = require('fs');

export const app = (c: Config, t: Theme) => [React, Btn, path, fs, c, t];
