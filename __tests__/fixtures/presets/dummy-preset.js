// Minimal fixture preset used by resolver + integration tests.
// Exports a default function that returns a single no-op plugin.

const noopPlugin = {
  name: 'dummy-fixture',
  version: '0.0.0',
  apply: () => {},
};

module.exports = function dummyPreset() {
  return [noopPlugin];
};
module.exports.default = module.exports;
