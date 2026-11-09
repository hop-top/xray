# Package Dependencies

Understand project dependencies across all package managers.

## Goal
Quickly see all dependencies without reading multiple package manager files.

## When to Use
- Onboarding to new project
- Auditing dependencies
- Understanding polyglot projects
- Planning upgrades
- Security audits

## Commands

### List all dependencies
```bash
xray package-manager list-dependencies
```
Shows all dependencies from package.json, Cargo.toml, requirements.txt, go.mod, pyproject.toml, etc.

### Summary by package manager
```bash
xray package-manager summary
```
Shows counts and stats for each package manager found.

## Supported Package Managers

- **npm/yarn/pnpm**: package.json, package-lock.json, yarn.lock, pnpm-lock.yaml
- **Cargo**: Cargo.toml, Cargo.lock
- **pip**: requirements.txt
- **poetry**: pyproject.toml
- **go mod**: go.mod

## Agent Tips

**Start with summary**: Use `summary` to see which package managers are in use.

**Full inventory**: Use `list-dependencies` to see all dependencies across all tools.

**Polyglot projects**: These commands unify output from multiple package managers in one view.

## Example Output

```bash
$ xray package-manager summary
Package Managers (3):

npm (package.json):
  - Dependencies: 45
  - Dev Dependencies: 23

Cargo (Cargo.toml):
  - Dependencies: 12

pip (requirements.txt):
  - Dependencies: 8

$ xray package-manager list-dependencies
Dependencies (88 total):

npm:
  - react: ^18.2.0
  - express: ^4.18.0
  - typescript: ^5.0.0

Cargo:
  - serde: 1.0
  - tokio: 1.28
```
