.PHONY: all build dev test test-parallel test-coverage check setup setup-ci clean

all: build

build:
	npm run build

dev:
	npm run dev

test:
	npm test

test-parallel:
	npm run test:parallel

test-coverage:
	npm run test:coverage

check: test

# --legacy-peer-deps: optional grammar peers (e.g. tree-sitter-kotlin) declare
# peer ranges npm's strict resolver rejects.
setup:
	npm install --legacy-peer-deps

# Lockfile-exact install (clean node_modules), for CI / reproducible setups.
setup-ci:
	npm ci --legacy-peer-deps

clean:
	rm -rf dist coverage
