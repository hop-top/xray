# CI/CD Pipeline

Understand continuous integration and deployment workflows.

## Goal
Quickly understand how code gets to production without reading CI/CD YAML files.

## When to Use
- Understanding deployment process
- Learning what triggers builds
- Troubleshooting CI failures
- Planning pipeline changes
- Understanding job dependencies

## Commands

### List all workflows
```bash
xray cicd workflows
```
Shows GitHub Actions, GitLab CI, and CircleCI workflows.

### Visualize pipeline
```bash
xray cicd graph
```
Shows job dependencies and execution flow.

**Generate visual diagram:**
```bash
xray cicd graph --format=dot | dot -Tpng > pipeline.png
```

### Show deployment workflows
```bash
xray cicd deploy
```
Filters to show only deployment-related jobs.

### Show workflow triggers
```bash
xray cicd triggers
```
Shows what triggers each workflow (push, PR, tags, schedule).

## Supported Platforms

- **GitHub Actions**: `.github/workflows/*.yml`
- **GitLab CI**: `.gitlab-ci.yml`
- **CircleCI**: `.circleci/config.yml`

## Agent Tips

**Start with workflows**: Use `cicd workflows` to see all pipelines.

**Focus on deploy**: Use `cicd deploy` to understand production path.

**Understand triggers**: Use `cicd triggers` to see what starts builds.

**Visualize flow**: Use `cicd graph` to see job dependencies.

## Example Output

```bash
$ xray cicd workflows
CI/CD Workflows (2):

GitHub Actions: CI (.github/workflows/ci.yml)
  Triggers: push, pull_request (branches: main, develop)
  Jobs (3):
    test
      Runs on: ubuntu-latest
      Steps: Checkout, Setup Node, Run tests

    build
      Runs on: ubuntu-latest
      Depends on: test
      Steps: Checkout, Build

    deploy
      Runs on: ubuntu-latest
      Depends on: build
      Condition: github.ref == 'refs/heads/main'
      Environment: production
      Steps: Deploy to AWS

$ xray cicd deploy
Deployment Workflows (1):

deploy (CI workflow)
  Trigger: push to main
  Dependencies: test → build → deploy
  Environment: production
  Steps:
    1. Configure AWS credentials
    2. Build and push Docker image
    3. Deploy to ECS

$ xray cicd triggers
Workflow Triggers:

CI workflow:
  - Push to: main, develop
  - Pull request to: main

Release workflow:
  - Tag matching: v*
```
