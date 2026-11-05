import type { FlowTable } from '../table';
import { typescriptTable } from './typescript';

/**
 * JavaScript / JSX (tree-sitter-javascript): the TypeScript statement and
 * expression shapes without the type syntax, so parameters are plain
 * patterns (no `required_parameter` wrapper).
 */
export const javascriptTable: FlowTable = {
  ...typescriptTable,
  language: 'javascript',
  paramPattern: {},
};
