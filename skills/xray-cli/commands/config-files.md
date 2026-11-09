# Configuration Files

Understand project configuration across all formats.

## Goal
Quickly see configuration files and keys without reading multiple formats (.env, JSON, YAML, TOML).

## When to Use
- Understanding configuration structure
- Finding environment variables
- Auditing configuration
- Setting up local development
- Security reviews

## Commands

### List all config files
```bash
xray config-files list
```
Shows all .env, JSON, YAML, and TOML configuration files.

### Extract configuration keys
```bash
xray config-files keys --file <file>
```
Shows all configuration keys from a specific file.

### Display configuration values
```bash
xray config-files values --file <file>
```
Shows configuration values (secrets redacted by default).

**Show secrets:**
```bash
xray config-files values --file <file> --show-secrets
```

## Supported Formats

- **Environment**: .env, .env.local, .env.production, etc.
- **JSON**: config.json, *.config.json
- **YAML**: config.yml, config.yaml, *.config.yaml
- **TOML**: config.toml

## Agent Tips

**Start with list**: Use `config-files list` to see all config files.

**Extract keys**: Use `config-files keys` to see structure without sensitive values.

**Security first**: Secrets are redacted by default, use `--show-secrets` only when needed.

**Nested configs**: For JSON/YAML, keys are shown with dot notation (e.g., `database.host`).

## Example Output

```bash
$ xray config-files list
Configuration Files (4):

.env
config/database.json
config/app.yaml
docker-compose.yml

$ xray config-files keys --file .env
Configuration Keys (.env):

DATABASE_URL
API_KEY
JWT_SECRET
PORT
NODE_ENV

$ xray config-files values --file .env
Configuration Values (.env):

DATABASE_URL = postgres://***
API_KEY = ***
JWT_SECRET = ***
PORT = 3000
NODE_ENV = development
```
