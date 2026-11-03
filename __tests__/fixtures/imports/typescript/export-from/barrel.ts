export { a, b as c } from './ab';
export { default } from './default';
export { default as Named, type T } from './named';
export * from './star';
export * as space from '@org/space';
export * as "string ns" from 'str-ns';
export { local };
export const local = 1;
