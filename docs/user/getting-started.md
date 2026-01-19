# Getting Started with xray

Get up and running with xray in under 60 seconds.

## Installation

### NPM (Recommended)

```bash
npm install -g xray
```

### From Source

```bash
git clone https://github.com/IdeaCraftersLabs/oss-xray-codes.git xray
cd xray
npm install --legacy-peer-deps
npm run build
npm link
```

**Note:** The `--legacy-peer-deps` flag is required due to tree-sitter peer dependencies. Requires C++ build tools (build-essential on Linux, Xcode on macOS).

**Troubleshooting C++ compilation:**
```bash
CXXFLAGS="-std=c++20" npm install --legacy-peer-deps
```

## Verify Installation

```bash
xray --version
```

## Your First xray Map

Generate a visual map of your codebase:

```bash
# Navigate to your project
cd /path/to/your/project

# Generate a basic map
xray map

# Output will be saved to .xray in current directory
```

## Quick Examples

### Analyze Specific Directory

```bash
xray map --path ./src --output codebase-map.txt
```

### Include Imports and Variables

```bash
xray map --path ./src --with incs --with vars --output analysis.txt
```

### Focus on Specific File

```bash
xray map --anchor src/main.ts --with incs --output focused.txt
```

## Shell Completion

Enable tab completion for faster workflow:

```bash
# For bash - add to ~/.bashrc or ~/.bash_profile
eval "$(xray completion bash)"

# For zsh - add to ~/.zshrc
eval "$(xray completion zsh)"

# For fish - save to completions directory
xray completion fish > ~/.config/fish/completions/xray.fish
```

## Next Steps

- [Commands Reference](commands.md) - Learn all available commands and options
- [Configuration](configuration.md) - Set up config files for your project
- [Strategies](strategies.md) - Use framework-specific analysis
- [Automation](automation.md) - Keep maps up-to-date automatically

## Common Issues

### "Command not found"

Ensure global install path is in PATH:
```bash
npm bin -g
```

Or use npx:
```bash
npx xray map
```

### Cache Issues

Clear cache if analysis seems stale:
```bash
xray clear-cache
```

## Getting Help

- Full documentation: [User Guide](../README.md)
- Troubleshooting: [Troubleshooting Guide](troubleshooting.md)
- Report issues: [GitHub Issues](https://github.com/IdeaCraftersLabs/oss-xray-codes/issues)
