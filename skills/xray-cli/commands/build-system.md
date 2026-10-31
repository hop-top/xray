# Build System

Understand how the project builds.

## Goal
Quickly discover build targets and dependencies without reading Makefiles, Justfiles, or npm scripts.

## When to Use
- Learning how to build a project
- Understanding build dependencies
- Finding test/lint/deploy targets
- Planning build optimizations
- Troubleshooting build issues

## Commands

### List build targets
```bash
xray build targets
```
Shows all targets from Makefile, Justfile, Taskfile, npm scripts.

### Visualize build dependencies
```bash
xray build graph
```
Shows which targets depend on others.

**Generate visual diagram:**
```bash
xray build graph --format=dot | dot -Tpng > build.png
```

### Run a build target
```bash
xray build run --target <target>
```
Executes the specified build target.

## Supported Build Tools

- **Make**: Makefile, makefile, *.mk
- **Just**: Justfile, justfile, .justfile
- **Task**: Taskfile.yml, Taskfile.yaml
- **npm scripts**: package.json scripts

## Agent Tips

**Start with targets**: Use `build targets` to see what's available.

**Understand flow**: Use `build graph` to see target dependencies (e.g., test depends on build).

**Common targets**: Look for: build, test, lint, clean, deploy, dev, start.

## Example Output

```bash
$ xray build targets
Build Targets (8):

Make (Makefile):
  all (default)
    → Depends on: build, test

  build
    → Recipe: gcc -o app src/*.c

  test
    → Depends on: build
    → Recipe: ./app --test

npm (package.json):
  build
    → Recipe: tsc && webpack

  test
    → Recipe: jest

  dev
    → Recipe: npm run build && nodemon

$ xray build graph
Build Dependencies:

all → build
all → test
test → build
dev → build
```
