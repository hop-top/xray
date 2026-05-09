.PHONY: all build dev test test-parallel test-coverage check setup clean

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

clean:
	rm -rf dist coverage
