#!/bin/bash

################################################################################
# Sequential Test Runner - Runs each test suite in a separate process
################################################################################
#
# WHY: Tree-sitter's native bindings maintain global state that gets corrupted
# when different language grammars load in the same Node process. Standard Jest
# isolation (maxWorkers=1, resetModules, beforeEach) cannot fix this because
# the corruption happens in native .node modules below Node's module system.
#
# SOLUTION: Spawn separate `jest <file>` processes for each test suite to
# ensure clean native module state.
#
# TRADE-OFF: Slower execution, cannot collect accurate coverage (requires
# single process), but all tests pass reliably.
#
################################################################################

echo "Running test suites sequentially..."
echo ""

# Find all test files
test_files=$(find __tests__ -name "*.test.ts" -type f | sort)

# Counters
total_suites=0
passed_suites=0
failed_suites=0
total_tests=0
passed_tests=0
failed_tests=0
skipped_tests=0

# Run each test file one by one
for test_file in $test_files; do
  echo "========================================"
  echo "Running: $test_file"
  echo "========================================"

  # Run jest and capture output
  if output=$(npx jest "$test_file" --coverage=false 2>&1); then
    # Test suite passed
    ((passed_suites++))
    echo "$output"

    # Extract test counts
    if [[ $output =~ Tests:[[:space:]]+([0-9]+)[[:space:]]+passed ]]; then
      ((passed_tests+=${BASH_REMATCH[1]}))
      ((total_tests+=${BASH_REMATCH[1]}))
    fi

    if [[ $output =~ ([0-9]+)[[:space:]]+skipped ]]; then
      ((skipped_tests+=${BASH_REMATCH[1]}))
      ((total_tests+=${BASH_REMATCH[1]}))
    fi
  else
    # Test suite failed
    ((failed_suites++))
    echo "$output"

    # Extract test counts from failed output
    if [[ $output =~ ([0-9]+)[[:space:]]+failed ]]; then
      ((failed_tests+=${BASH_REMATCH[1]}))
      ((total_tests+=${BASH_REMATCH[1]}))
    fi

    if [[ $output =~ ([0-9]+)[[:space:]]+passed ]]; then
      ((passed_tests+=${BASH_REMATCH[1]}))
      ((total_tests+=${BASH_REMATCH[1]}))
    fi

    if [[ $output =~ ([0-9]+)[[:space:]]+skipped ]]; then
      ((skipped_tests+=${BASH_REMATCH[1]}))
      ((total_tests+=${BASH_REMATCH[1]}))
    fi
  fi

  ((total_suites++))
  echo ""
done

# Print consolidated summary
echo "========================================"
echo "CONSOLIDATED TEST RESULTS"
echo "========================================"
echo "Test Suites: $passed_suites passed, $failed_suites failed, $total_suites total"
echo "Tests:       $passed_tests passed, $failed_tests failed, $skipped_tests skipped, $total_tests total"
echo ""

# Exit with error if any suites failed
if [ $failed_suites -gt 0 ]; then
  exit 1
fi
