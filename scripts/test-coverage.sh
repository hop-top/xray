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

echo "Running tests with coverage..."
echo ""
echo "⚠️  Some tests will fail due to tree-sitter single-process limitation."
echo ""

npx jest --coverage --maxWorkers=1

echo ""
echo "Coverage report completed."
