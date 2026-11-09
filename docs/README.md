# xray Documentation

Complete documentation for xray - the intelligent codebase visualization tool.

## Getting Started

New to xray? Start here:

- [Getting Started](user/getting-started.md) - Installation, setup, and your first code map
- [Quick Reference](../README.md#quick-start) - Main README quick start guide

## User Documentation

Documentation for using xray:

- **[Getting Started](user/getting-started.md)** - Installation and first steps
- **[Commands Reference](user/commands.md)** - Complete command reference with all options
- **[Configuration](user/configuration.md)** - Config files, lenses, and scopes
- **[Strategies](user/strategies.md)** - Framework-specific analysis (React, Express, Go CLI, etc.)
- **[Automation](user/automation.md)** - GitHub Actions and pre-commit hooks
- **[Troubleshooting](user/troubleshooting.md)** - Common issues and solutions

## Developer Documentation

Documentation for contributing and extending xray:

- **[Architecture](dev/architecture.md)** - System design and technical overview
- **[Strategy Development](dev/strategy-development.md)** - Creating custom strategies
- **[Strategy API Reference](dev/strategy-api.md)** - Strategy command system
- **[Contributing](dev/contributing.md)** - Development setup and workflow

## Additional Resources

- **[GitHub Action Guide](user/automation.md#github-action-details)** - Using the xray GitHub Action
- **[Code of Conduct](../CODE_OF_CONDUCT.md)** - Community guidelines

## Project Documentation (Internal)

Historical and planning documents:

- [Releases](https://github.com/hop-top/xray/releases) - Release notes

## Quick Links

### User Guides
- [Installation](user/getting-started.md#installation-30-seconds)
- [Quick Start](user/getting-started.md#your-first-map-30-seconds)
- [Shell Completion](user/getting-started.md#enable-shell-completion)
- [React Strategy](user/strategies.md#react-strategy)
- [Express Strategy](user/strategies.md#express-strategy)
- [GitHub Action Setup](user/automation.md#github-action-details)
- [Pre-commit Hook](user/automation.md#pre-commit-hook-details)

### Developer Guides
- [Development Setup](dev/contributing.md#development-setup)
- [Running Tests](dev/contributing.md#testing)
- [Adding Languages](dev/contributing.md#adding-a-new-language)
- [Creating Strategies](dev/strategy-development.md#adding-new-strategies)
- [Code Style](dev/contributing.md#code-style)

## Documentation Structure

```
docs/
├── README.md (this file)           # Documentation index
├── user/                           # User-facing documentation
│   ├── getting-started.md
│   ├── commands.md
│   ├── configuration.md
│   ├── strategies.md
│   ├── automation.md
│   └── troubleshooting.md
├── dev/                            # Developer documentation
│   ├── architecture.md
│   ├── strategy-development.md
│   ├── strategy-api.md
│   └── contributing.md
├── github-action.md                # GitHub Action reference
└── plans/                          # Planning documents
```

## Getting Help

- **Questions**: [GitHub Discussions](https://github.com/hop-top/xray/discussions)
- **Bugs**: [GitHub Issues](https://github.com/hop-top/xray/issues)
- **Documentation Issues**: Report in [GitHub Issues](https://github.com/hop-top/xray/issues) with `documentation` label

## Contributing to Documentation

Found an error or want to improve the documentation? See our [Contributing Guide](dev/contributing.md#documentation).

## License

MIT License - see [LICENSE](../LICENSE) file for details.
