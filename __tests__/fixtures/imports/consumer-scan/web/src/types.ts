// Type-position import(): erased at compile time, typeOnly.
export type Store = import('redux').Store;
export const lazy = () => import('./lazy');
