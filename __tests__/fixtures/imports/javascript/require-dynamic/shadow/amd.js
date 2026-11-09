// `require` is bound in this file (parameter): its calls are not the
// global require, so no record (deferred as shadowed).
define(function (require) {
  const dep = require('amd-dep');
  return dep;
});
import('still-dynamic');
