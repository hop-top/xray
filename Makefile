.PHONY: all build dev test test-parallel test-coverage check setup setup-ci clean promote promote-beta promote-rc promote-open-line

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

# Target-versioning steps (RELEASING.md), recorded in the release-please
# config by hop-top/.github's promote.js and committed on the current branch
# (push it to next). DRY_RUN=1 prints only; NO_COMMIT=1 writes, no commit.
#   make promote-beta
#   make promote-rc DRY_RUN=1
#   make promote-open-line LINE=1.0.0
#   make promote ARGS='clear channel --package xray'
PROMOTE_SELECT = --package xray $(if $(DRY_RUN),--dry-run) $(if $(NO_COMMIT),--no-commit)

promote: ## Run promote.js with ARGS (channel | open-line | clear; see RELEASING.md)
	@scripts/promote-release.sh $(ARGS)

promote-beta promote-rc: ## Promote xray to the next channel on its current line
	@scripts/promote-release.sh channel $(subst promote-,,$@) $(PROMOTE_SELECT)

promote-open-line: ## Open line LINE (x.y.z) for xray
	@scripts/promote-release.sh open-line $(LINE) $(PROMOTE_SELECT)
