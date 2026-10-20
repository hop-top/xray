#!/bin/bash

################################################################################
# Coverage Test Runner - Some tests will fail
################################################################################
#
# WHY: Coverage requires single-process execution, but tree-sitter native
# bindings corrupt when multiple grammars load in one process (~13 tests fail).
# See test-sequential.sh for details.
#
# USE: 'npm test' for reliable results, this script for coverage reports.
#
################################################################################

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$script_dir/lib/test-lock.sh"
trap _xray_release_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
acquire_test_lock || exit 1

echo "Running tests with coverage..."
echo ""
echo "⚠️  Some tests will fail due to tree-sitter single-process limitation."
echo ""

NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=${XRAY_TEST_MAX_OLD_SPACE_MB:-4096}" npx jest --coverage --maxWorkers=1

echo ""
echo "Coverage report completed."
