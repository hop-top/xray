# Xray Code Regenerator - GitHub Action

Automatically regenerate xray code maps when source files change in pull requests.

## Features

- 🔄 **Automatic Updates**: Regenerates xray maps on every PR update
- ⚙️ **Config-Based**: Uses your project's xray configuration file
- 📦 **Zero Config**: Auto-detects configuration files
- 🎯 **Selective Triggers**: Only runs when source files change
- 💬 **Smart Commits**: Only commits when maps actually change

## Quick Start

### 1. Create xray configuration

Create a `.xrayrc.json` in your repository root:

```json
{
  "paths": ["./src"],
  "output": "docs/codebase-map.txt",
  "limit": 8000,
  "features": {
    "vars": true,
    "incs": true
  }
}
```

### 2. Add workflow file

Create `.github/workflows/xray-regenerate.yml`:

```yaml
name: Regenerate Xray Maps

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - '**.ts'
      - '**.js'
      - '**.py'
      # Add other extensions as needed

jobs:
  regenerate-xray:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.head_ref }}

      - uses: IdeaCraftersLabs/oss-xray-codes@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### 3. Commit and push

That's it! The action will now automatically regenerate your xray maps on every PR.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for committing changes | No | `${{ github.token }}` |
| `config-path` | Path to xray config file | No | Auto-detect |
| `xray-version` | Version of xray to install | No | `latest` |
| `commit-message` | Commit message for updates | No | `chore: regenerate xray maps` |
| `skip-if-no-changes` | Skip commit if no changes | No | `true` |

## Advanced Usage

### Custom Config Path

```yaml
- uses: IdeaCraftersLabs/oss-xray-codes@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    config-path: './config/xray.json'
```

### Custom Commit Message

```yaml
- uses: IdeaCraftersLabs/oss-xray-codes@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    commit-message: |
      docs: update xray visualizations

      Auto-generated from source code changes
```

### Specific xray Version

```yaml
- uses: IdeaCraftersLabs/oss-xray-codes@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    xray-version: '1.0.0'
```

### Multiple Configurations

Run different xray configurations in parallel:

```yaml
jobs:
  regenerate-xray:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        preset: [quick, detailed, api]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install xray
        run: npm install -g xray

      - name: Generate ${{ matrix.preset }} map
        run: xray map --preset ${{ matrix.preset }}

      - name: Commit changes
        run: |
          git config --local user.email "actions@github.com"
          git config --local user.name "GitHub Actions"
          git add .
          git commit -m "docs: update ${{ matrix.preset }} xray map" || exit 0
          git push
```

## Triggering the Action

### On Source File Changes

```yaml
on:
  pull_request:
    paths:
      - '**.ts'
      - '**.tsx'
      - '**.js'
      - '**.jsx'
      - '**.py'
      - '**.java'
      - '**.go'
      - '**.rs'
```

### On Config Changes

```yaml
on:
  pull_request:
    paths:
      - '.xrayrc*'
      - 'xray.config.*'
      - 'src/**'
```

### On Push to Main

```yaml
on:
  push:
    branches:
      - main
    paths:
      - 'src/**'
```

## Troubleshooting

### Action fails with "No config file found"

Ensure you have created a configuration file in one of these locations:
- `.xrayrc`
- `.xrayrc.json`
- `xray.config.json`
- `xray.config.js`
- `package.json` (under `"xray"` field)

### Changes not being committed

Check that your workflow has the correct permissions:

```yaml
permissions:
  contents: write
  pull-requests: write
```

### Action runs but doesn't update maps

1. Verify your xray config is correct by running locally: `xray map`
2. Check the action logs for errors
3. Ensure output paths in config are correct

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [xray CLI Documentation](https://github.com/IdeaCraftersLabs/oss-xray-codes)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Report Issues](https://github.com/IdeaCraftersLabs/oss-xray-codes/issues)
