# Go CLI Strategy

The Go CLI strategy detects and analyzes Go-based command-line interface applications, supporting popular frameworks like Cobra and urfave/cli, as well as the standard Go flag package.

## Detection

The strategy detects Go CLI projects by checking for:

1. **Cobra framework** (`github.com/spf13/cobra`) in `go.mod`
2. **urfave/cli framework** (`github.com/urfave/cli`) in `go.mod`
3. **cmd/ directory structure** with Go files
4. **Standard flag package** usage in `main.go`
5. **CLI framework imports** in Go source files

## Supported Frameworks

### Cobra

The most popular Go CLI framework. The strategy detects:

- Command definitions (`&cobra.Command{}`)
- Command hierarchy (via `AddCommand()` calls)
- Flag definitions (StringP, BoolP, IntP, etc.)
- Root and subcommands

Example:
```go
var rootCmd = &cobra.Command{
    Use:   "myapp",
    Short: "A brief description",
    Long:  "A longer description",
}

var serveCmd = &cobra.Command{
    Use:   "serve",
    Short: "Start the server",
}

func init() {
    rootCmd.AddCommand(serveCmd)
    rootCmd.Flags().StringP("config", "c", "", "config file")
}
```

### urfave/cli

A simple and expressive CLI framework. The strategy detects:

- App definitions (`&cli.App{}`)
- Command definitions (`&cli.Command{}`)
- Flag definitions (StringFlag, BoolFlag, etc.)

Example:
```go
var app = &cli.App{
    Name:  "myapp",
    Usage: "do awesome things",
    Flags: []cli.Flag{
        &cli.StringFlag{
            Name:  "config",
            Usage: "config file",
        },
    },
}
```

### Standard flag Package

The built-in Go flag package. The strategy detects:

- Flag definitions (String, Bool, Int, etc.)
- Flag variables

Example:
```go
var (
    verbose = flag.Bool("verbose", false, "verbose mode")
    config  = flag.String("config", "default.conf", "config file")
)
```

## Commands

### List Commands

```bash
xray go-cli:commands
```

Lists all CLI commands defined in the project, including:
- Command name
- Short description
- File location

### List Flags

```bash
xray go-cli:flags
```

Lists all command-line flags, including:
- Flag name
- Type (string, bool, int, etc.)
- Usage description
- File location

### Show Command Tree

```bash
xray go-cli:tree
```

Displays the command hierarchy showing parent-child relationships between commands.

## Analysis Features

The strategy provides detailed analysis of:

### Commands
- Command names (Use field)
- Short and long descriptions
- Multiple commands per file

### Flags
- Flag names
- Flag types (string, bool, int, float, duration)
- Short/long forms (e.g., `-v` / `--verbose`)
- Default values
- Usage descriptions

### Command Hierarchy
- Parent-child command relationships
- Command tree structure
- AddCommand() call detection

## File Types

The strategy analyzes:
- `.go` files

## Ignore Patterns

The strategy ignores:
- `**/*_test.go` - Test files
- `**/vendor/**` - Vendor dependencies
- `**/testdata/**` - Test data directories

## Tags

The strategy adds the following tags to analyzed files:

- `go-cli:command` - Files containing command definitions
- `go-cli:flags` - Files containing flag definitions
- `go-cli:hierarchy` - Files containing command hierarchy (AddCommand calls)
- `go-cli:urfave-app` - Files containing urfave/cli App definitions

## Metadata

For each analyzed file, the strategy extracts:

### Commands
- `commandName` - The command name
- `commandShort` - Short description
- `commandLong` - Long description
- `commands` - Array of commands (if multiple in one file)

### Flags
- `flags` - Array of flag definitions with:
  - `name` - Flag name
  - `type` - Flag type
  - `usage` - Usage description
  - `shorthand` - Short form (e.g., "v" for verbose)

### Hierarchy
- `hierarchy` - Array of parent-child relationships:
  - `parent` - Parent command name
  - `child` - Child command name

### urfave/cli
- `appName` - Application name
- `appUsage` - Application usage
- `urfaveCommands` - Array of urfave/cli commands

## Examples

### Detect CLI project
```bash
cd my-go-cli-project
xray detect
# Output: Detected strategies: go-cli
```

### List all commands
```bash
xray go-cli:commands
# Output:
# Go CLI Commands:
# - myapp (A CLI application) [cmd/root.go]
# - serve (Start the server) [cmd/serve.go]
# - deploy (Deploy the application) [cmd/deploy.go]
```

### List all flags
```bash
xray go-cli:flags
# Output:
# Go CLI Flags:
# - config (string): Configuration file path [cmd/root.go]
# - verbose (bool): Verbose output [cmd/root.go]
# - port (int): Server port [cmd/serve.go]
```

### Show command hierarchy
```bash
xray go-cli:tree
# Output:
# Command Tree:
# myapp
#   ├─ serve
#   ├─ deploy
#   └─ version
```

## Version

**v0.0.1-alpha.1** - Initial implementation
- Cobra framework detection and analysis
- urfave/cli framework detection and analysis
- Standard flag package detection
- Command hierarchy detection (AddCommand calls)
- Flag parsing for all major types (string, bool, int, etc.)
- Support for both short and long flag forms
