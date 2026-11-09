// An ambient declaration types the global; it does not shadow it.
declare const require: (id: string) => unknown;
declare function require(id: string): unknown;
require('ambient-ok');
