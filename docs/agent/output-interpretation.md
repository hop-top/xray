# Output Interpretation Guide

How to parse and interpret xray output as an agent. Includes common patterns, examples, and how to extract actionable information.

## Table of Contents

1. [Output Formats](#output-formats)
2. [Map Output Structure](#map-output-structure)
3. [Explore Output Structure](#explore-output-structure)
4. [File Match Output Structure](#file-match-output-structure)
5. [Graph Output Structure](#graph-output-structure)
6. [Error Messages](#error-messages)
7. [Parsing Strategies](#parsing-strategies)

## Output Formats

xray produces output in different formats based on command:

| Command | Default Format | Other Formats |
|---------|----------------|---------------|
| `map` | Markdown tree | JSON, CSV (nodes+edges files), XML |
| `explore` | Plain text list | Plain text |
| `graph` | Plain text (CFG/DFG per function) | JSON, CSV, XML |
| `strategy *` | Plain text | Plain text |

**How to Parse:**
- Markdown: Parse heading levels, list markers, code blocks
- Plain text: Parse lines, look for structure
- JSON: Parse object/array structure
- XML: One `<graph>` document

## Map Output Structure

### Example Map Output

```markdown
# Codebase Map

## root (L1-L50):

### src/

api/ (15 files)
│ [L1-L20] function setupRoutes
│ [L25-L45] class ApiRouter
│ [L50-L100] async function handleRequest
│ [L105] const API_BASE_URL

components/ (8 files)
│ [L1-L40] function Button
│ [L50-L100] function Card
│ [L110-L160] class Modal

services/ (5 files)
│ [L1-L50] class AuthService
│ [L60-L120] async function fetchUser
│ [L130] const logger

## External Dependencies

| Library | Used By |
|---------|---------|
| react | components/*, hooks.ts |
| express | api/routes.ts |
| axios | services/api.ts |
```

### Parsing Map Output

**Structure Elements:**

```markdown
# Codebase Map
├─ Top-level heading
└─ Indicates map output

## root (L1-L50):
├─ Directory section heading
├─ "root" = directory name
└─ (L1-L50) = line range

### src/
├─ Subdirectory heading
└─ Indicates nested directory

api/ (15 files)
├─ Directory with file count
└─ Useful for understanding size

│ [L1-L20] function setupRoutes
├─ Item (function/class) entry
├─ [L1-L20] = location
└─ "function setupRoutes" = what it is
```

### Extracting Information from Map

**Extract: Directory Structure**

```python
def extract_structure(map_output: str):
    """Extract directory tree from map"""
    lines = map_output.split('\n')
    structure = {}

    for line in lines:
        if line.startswith('### '):
            # Subdirectory
            dir_name = line.replace('### ', '').replace('/', '')
        elif ' files)' in line and not line.startswith('│'):
            # Directory with count
            match = re.search(r'(\w+)/ \((\d+) files\)', line)
            if match:
                dir_name, count = match.groups()
                structure[dir_name] = int(count)

    return structure
```

**Extract: Functions/Classes**

```python
def extract_definitions(map_output: str):
    """Extract all functions, classes, etc."""
    definitions = []

    for line in map_output.split('\n'):
        # Look for lines with [Lxx-Lyy] pattern
        match = re.search(r'\[L(\d+)-L(\d+)\]\s+(function|class|const)\s+(\w+)', line)
        if match:
            start, end, kind, name = match.groups()
            definitions.append({
                'name': name,
                'kind': kind,
                'lines': f"{start}-{end}"
            })

    return definitions
```

**Extract: Dependencies**

```python
def extract_dependencies(map_output: str):
    """Extract external dependencies"""
    deps = {}
    in_deps_table = False

    for line in map_output.split('\n'):
        if 'External Dependencies' in line:
            in_deps_table = True
        elif in_deps_table:
            if '|' in line and '---' not in line:
                # Table row
                parts = [p.strip() for p in line.split('|')]
                if len(parts) >= 3 and parts[0] and parts[1]:
                    lib = parts[1]
                    files = parts[2]
                    deps[lib] = [f.strip() for f in files.split(',')]

    return deps
```

### Understanding Line Ranges

**Format: `[L1-L50]` or `[L42]`**

```
[L1-L50]    = Lines 1 through 50 (multi-line item)
[L42]       = Line 42 only (single-line item)
[L5-L12]    = Lines 5 through 12

Interpretation:
- Used to locate items in source files
- Can cross-reference with actual files
- Shows approximate size of functions/classes
```

### Chunked Output Markers

**When output is chunked:**

```markdown
---
## Navigation

⬆️ **Parent:** [src](../.xray_src.md)

⬇️ **Children:**
  - [src/lib](../.xray_src_lib.md)
  - [src/commands](../.xray_src_commands.md)

---
```

**Parsing Navigation:**

```python
def extract_navigation(chunk_content: str):
    """Extract navigation from chunked output"""
    nav = {'parent': None, 'children': []}

    lines = chunk_content.split('\n')
    for i, line in enumerate(lines):
        if '⬆️' in line and 'Parent' in line:
            # Next line has link
            if i+1 < len(lines):
                match = re.search(r'\[(.+?)\]\((.+?)\)', lines[i+1])
                if match:
                    nav['parent'] = {'name': match.group(1), 'link': match.group(2)}

        elif '⬇️' in line and 'Children' in line:
            # Following lines have child links
            j = i + 1
            while j < len(lines):
                match = re.search(r'\[(.+?)\]\((.+?)\)', lines[j])
                if match:
                    nav['children'].append({'name': match.group(1), 'link': match.group(2)})
                j += 1

    return nav
```

## Explore Output Structure

### Example Explore Output

```
React Components:
  App - src/App.tsx (function)
  Button - src/components/Button.tsx (function)
  UserProfile - src/components/UserProfile.tsx (class)
  Card - src/components/Card.tsx (function)

React Hooks:
  useUser - src/hooks/useUser.ts
  useAuth - src/hooks/useAuth.ts
  useFetch - src/hooks/useFetch.ts
```

### Parsing Explore Output

**Extract List Items:**

```python
def extract_explore_items(output: str):
    """Extract items from explore command"""
    items = []
    current_category = None

    for line in output.split('\n'):
        line = line.strip()

        if line.endswith(':') and not line.startswith('-'):
            # Category header
            current_category = line.rstrip(':')

        elif line.startswith('-'):
            # List item
            # Format: "- Name - path/to/file.ext"
            match = re.search(r'-\s+(.+?)\s+-\s+(.+?)(?:\s+\((.+?)\))?$', line)
            if match:
                name, path, kind = match.groups()
                items.append({
                    'category': current_category,
                    'name': name.strip(),
                    'path': path.strip(),
                    'kind': kind.strip() if kind else None
                })

    return items
```

**Example Usage:**

```python
output = """
React Components:
  - App - src/App.tsx (function)
  - Button - src/components/Button.tsx (function)
"""

items = extract_explore_items(output)
# Result: [
#   {'category': 'React Components', 'name': 'App', 'path': 'src/App.tsx', 'kind': 'function'},
#   {'category': 'React Components', 'name': 'Button', 'path': 'src/components/Button.tsx', 'kind': 'function'}
# ]
```

## File Match Output Structure

### Example `explore --match` Output

stdout carries one absolute path per line, indented two spaces. The
`Found N file(s) matching pattern(s):` line goes to stderr.

```
stderr: ℹ Found 3 file(s) matching pattern(s):

stdout:
  /repo/src/index.ts
  /repo/src/App.tsx
  /repo/src/components/Button.tsx
```

With `--format json`, stdout is an array of `{"path": ...}` objects.

### Parsing File Match Output

**Extract File List:**

```python
def extract_file_list(stdout: str):
    """Paths from `xray explore --match ...` (stdout only)"""
    return [line.strip() for line in stdout.splitlines() if line.strip()]
```

**Extract File Count:**

```python
def extract_match_count(files: list):
    return len(files)
```

## Graph Output Structure

### Example Graph Output (text)

`xray graph --no-chunk -o graph.txt` writes one block per function with its
control-flow (`cfg`) and data-flow (`dfg`) nodes:

```
src/b.ts (L1):
│ [L1] function b()
│   cfg
│     n0 entry L1 → n2
│     n1 exit L1
│     n2 return L1 return 1 → n1
│   dfg
│       → used by: [src/a.ts:L2](L2-L2)
```

### Parsing Graph Output

For programmatic use, write JSON (`xray graph --format json --no-chunk -o graph.json`)
and read `nodes` and `edges`.

**Extract Relationships:**

```python
import json

def extract_graph_relationships(path: str):
    """Edges from an xray JSON graph"""
    with open(path) as f:
        graph = json.load(f)
    return [
        {'from': e['source'], 'to': e['target'], 'type': e['type']}
        for e in graph['edges']
    ]
```

## Error Messages

### Common Error Patterns

**Error: Invalid Path**

```
Error: ENOENT: no such file or directory
Cannot find path: ./nonexistent/src
```

**What it means:** Path doesn't exist
**Recovery:** Check path exists, use absolute path, verify spelling

**Error: Permission Denied**

```
Error: EACCES: permission denied
Cannot access: /root/protected/src
```

**What it means:** Don't have read permissions
**Recovery:** Check permissions, use different path, ask user for help

**Error: Strategy Not Found**

```
Error: Strategy not recognized
Unknown strategy: "foo"
Available: react, express, rest-api, go-cli
```

**What it means:** Requested strategy doesn't exist
**Recovery:** Use correct name, use `strategy list` to see available

**Error: No Strategies Detected**

```
Warning: No strategies detected
Proceeding with generic analysis
```

**What it means:** Framework couldn't be auto-detected
**Recovery:** Normal for custom projects, continue with analysis

### Parsing Error Messages

```python
def parse_error(output: str):
    """Extract error information"""
    error_info = {
        'is_error': 'Error:' in output or 'Error' in output,
        'is_warning': 'Warning' in output,
        'message': None,
        'recovery': None
    }

    if error_info['is_error'] or error_info['is_warning']:
        # Extract message
        for line in output.split('\n'):
            if 'Error:' in line or 'Error' in line:
                error_info['message'] = line.split('Error:')[1].strip()
                break

    return error_info
```

## Parsing Strategies

### Strategy 1: Line-by-Line Parsing

```python
def parse_line_by_line(output: str):
    """Parse output line by line"""
    results = []

    for line in output.split('\n'):
        line = line.strip()

        # Skip empty lines and headers
        if not line or line.startswith('#') or line.startswith('---'):
            continue

        # Process content
        if ' - ' in line:
            # Format: name - path
            parts = line.split(' - ')
            if len(parts) >= 2:
                results.append({
                    'name': parts[0].strip(),
                    'path': parts[1].strip()
                })

    return results
```

### Strategy 2: Regex-Based Parsing

```python
import re

def parse_with_regex(output: str, pattern: str):
    """Parse using regex pattern"""
    results = []

    for match in re.finditer(pattern, output):
        results.append(match.groupdict())

    return results

# Usage
pattern = r'\[L(?P<start>\d+)-L(?P<end>\d+)\]\s+(?P<kind>\w+)\s+(?P<name>\w+)'
results = parse_with_regex(output, pattern)
```

### Strategy 3: Structured Parsing with State

```python
def parse_structured(output: str):
    """Parse using state machine"""
    state = 'INIT'
    results = {}
    current_section = None

    for line in output.split('\n'):
        line = line.strip()

        # State transitions
        if line.endswith(':') and not line.startswith('│'):
            state = 'IN_SECTION'
            current_section = line.rstrip(':')
            results[current_section] = []

        elif state == 'IN_SECTION':
            if line.startswith('│') or line.startswith('-'):
                # Item in section
                results[current_section].append(line)
            elif line and not line.startswith('│'):
                # New section
                state = 'IN_SECTION'
                current_section = line.rstrip(':')
                results[current_section] = []

    return results
```

## Validation: Is Output Valid?

**Before acting on xray output, verify:**

```python
def validate_output(output: str, expected_format: str):
    """Validate xray output"""
    checks = {
        'not_empty': len(output.strip()) > 0,
        'has_content': not output.startswith('Error'),
        'parse_valid': False,
        'has_results': False
    }

    # Format-specific validation
    if expected_format == 'markdown':
        checks['parse_valid'] = '#' in output or '│' in output
    elif expected_format == 'list':
        checks['parse_valid'] = '-' in output or ':' in output
    elif expected_format == 'json':
        checks['parse_valid'] = output.lstrip().startswith('{')

    checks['has_results'] = any([
        'component' in output.lower(),
        'route' in output.lower(),
        'function' in output.lower(),
        'class' in output.lower(),
        'file' in output.lower()
    ])

    return checks
```

## Quick Reference: What to Look For

| Command | Look For | Extraction |
|---------|----------|-----------|
| `map` | `[L...-L...]` markers | Functions/classes and line numbers |
| `map` | Directory sections `##` | File organization |
| `map` | Dependencies table | External imports |
| `explore` | List items with `-` | Components, routes, hooks |
| `explore --match` | Absolute paths, one per line (stdout) | Files matched; the count is on stderr |
| `graph` | Arrows `-->` or `->` | Relationships and flow |
| `strategy detect` | Strategy names | Detected frameworks |

## Common Interpretation Mistakes

**Mistake 1: Ignoring Chunked Output**

```
Output: Multiple .xray_*.md files
WRONG: Try to read all at once
RIGHT: Follow navigation links, read sections as needed
```

**Mistake 2: Misunderstanding Line Ranges**

```
Output: [L1-L50] function foo
WRONG: "This function is 50 lines"
RIGHT: "This function is defined in lines 1-50 (might be less)"
```

**Mistake 3: Assuming Completeness**

```
Output: "Found 10 components"
WRONG: "There are exactly 10 components"
RIGHT: "Found 10 matching the search criteria (might be more)"
```

**Mistake 4: Ignoring Context**

```
Output: "api/ (15 files)"
WRONG: "Only 15 files in API layer"
RIGHT: "xray analyzed 15 files in api/ directory (might be more in subdirs)"
```

## Related Documentation

- [Output Interpretation](output-interpretation.md) - This guide
- [Chunked Output Navigation](#chunked-output-markers) - Working with multiple files
- [Integration Protocol](integration-protocol.md) - When/how to use xray

---

**Key Principle:** xray output is highly structured. Learn the patterns, parse mechanically, validate results before acting on them.
