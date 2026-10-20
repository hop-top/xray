// Preload for bin-fatal test: make main() reject before commander parse.
const path = require('path');
const consent = require(path.resolve(__dirname, '../../dist/lib/telemetry-consent'));
consent.handleFirstRunConsent = async () => {
  const mode = process.env.XRAY_TEST_REJECT;
  if (mode === 'coded') {
    const { UsageError } = require(path.resolve(__dirname, '../../dist/lib/error/types'));
    throw new UsageError('boom-coded');
  }
  throw new Error('boom-plain');
};
