// Call-based forms with literal arguments.
const lodash = require('lodash/fp');
const local = require('./util');

async function load() {
  const chart = await import('chart.js');
  return [lodash, local, chart];
}
module.exports = { load };
