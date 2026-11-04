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

setup:
	npm install

# Lockfile-exact install (clean node_modules), for CI / reproducible setups.
setup-ci:
	npm ci

clean:
	rm -rf dist coverage
