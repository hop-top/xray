import fs from 'fs';
import { join, resolve as res } from "node:path";
import * as ns from '@scope/pkg/sub/path';
import def, { a, "string-name" as sn } from 'lodash/fp';
import './side-effect';
import data from './data.json' with { type: 'json' };
import legacy = require('legacy-lib');
const s = 'é😀'; import late from '../up/late';
import {
  multi,
  line,
} from '#internal/alias';
import {} from 'empty-braces';

export function f() {
  return fs && join && res && ns && def && a && sn && data && legacy && late && multi && line;
}
