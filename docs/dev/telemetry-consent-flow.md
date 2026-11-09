# Telemetry Consent Flow

## Overview

Xray implements a privacy-first telemetry consent system that prompts users on first run. This document explains how the consent flow works and how it integrates with the CLI.

## Design Principles

1. **Opt-in by Default**: Telemetry is disabled unless user explicitly consents
2. **Non-Intrusive**: Prompt only shows once, on first run
3. **Transparent**: Clear explanation of what data is/isn't collected
4. **Respectful**: Easy to decline, no dark patterns
5. **CI-Friendly**: Automatically skips prompt in non-interactive environments

## Flow Diagram

```
┌─────────────────────────────┐
│   User runs xray command    │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Forced off? (telemetry-    │
│  policy: --no-telemetry,    │
│  XRAY_NO_TELEMETRY /        │
│  DO_NOT_TRACK, mcp, CI,     │
│  machine format, non-TTY    │
│  stdout)                    │
└──────────┬──────────────────┘
           │
           ├─ Yes ──▶ Disable telemetry (saved decision ignored), continue
           │
           ▼ No
┌─────────────────────────────┐
│ Check if consent exists     │
│ (project/--config, then     │
│  global user config)        │
└──────────┬──────────────────┘
           │
           ├─ Yes ──▶ Use saved decision, continue
           │
           ▼ No
┌─────────────────────────────┐
│  Check stdin is a TTY       │
│  (can prompt)               │
└──────────┬──────────────────┘
           │
           ├─ No ──▶ Disable telemetry (nothing saved), continue
           │
           ▼ Yes
┌─────────────────────────────┐
│    Display consent prompt   │
│    (explain data collected) │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│   User answers Y/n          │
└──────────┬──────────────────┘
           │
           ├─ Y ──▶ Enable telemetry
           │
           ▼ n
           Disable telemetry
           │
           ▼
┌─────────────────────────────┐
│   Save decision to global   │
│   user config.json          │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│   Initialize telemetry      │
│   Continue command execution│
└─────────────────────────────┘
```

## Implementation

### Entry Point

**File:** `src/index.ts`

```typescript
async function main() {
  // Handle first-run telemetry consent
  const telemetryEnabled = await handleFirstRunConsent(process.argv);

  // Initialize telemetry based on consent
  const telemetry = initializeTelemetry({
    enabled: telemetryEnabled,
    projectRoot: process.cwd(),
  });

  // Continue with command registration...
}
```

### Consent Logic

**File:** `src/lib/telemetry-consent.ts`

#### Key Functions

**`handleFirstRunConsent(argv: string[]): Promise<boolean>`**

Main entry point for consent flow. Returns `true` if telemetry should be enabled.

**Logic:**
1. `telemetryOffReason()` (`src/lib/telemetry-policy.ts`) non-null → return `false`, nothing saved
2. Check existing decision → return saved value
3. stdin not a TTY → return `false`, nothing saved
4. Prompt user → answer; no answer (15 s timeout, end of input) = `false`
5. Save decision → persist to config (also for no answer)

**`hasConsentDecision(): boolean`**

Checks if user has already made a decision (config exists with `telemetry` setting).

**`telemetryOffReason(): TelemetryOffReason | null`** (`src/lib/telemetry-policy.ts`)

Single decision point for forced-off runs, ahead of any saved decision:
`flag`, `env` (`XRAY_NO_TELEMETRY` / `DO_NOT_TRACK`), `mcp`, `ci`,
`machine-format` (`--format json|yaml|csv|xml`, `--json`, `--csv`, `--xml`,
or a `MACHINE_DEFAULT_COMMANDS` command such as `imports` / `describe`
without `--format text|table|txt`),
`non-tty` (stdout). `TelemetryPlugin` checks it too, so no recorder
(CLI tracker, `Xray` auto-registered plugin, library use) bypasses it.
`xray describe` publishes `TELEMETRY_POLICY`.

**`promptForConsent(): Promise<boolean>`**

Displays informative prompt and gets user answer. Uses `readline` for input. Gives up after `CONSENT_PROMPT_TIMEOUT_MS` (15 s); a timeout or end of input (Ctrl-D) is a decline.

**`saveConsentDecision(enabled: boolean): void`**

Saves decision to the global user config (`config.json` in the kit XDG config dir), creating it if needed. Never writes the cwd, a project config or `--config`. A JS global config is left untouched.

## Consent Prompt

### What Users See

```
Welcome to Xray!

Xray can collect anonymous usage data to help improve the tool.

What data is collected:
  • Command usage (which commands you run)
  • Performance metrics (execution time, memory usage)
  • Error types (what errors occur)
  • System info (OS, architecture, Node version)

What is NOT collected:
  • Your source code or file contents
  • File paths (except in error context)
  • Personal information
  • Network activity (data stays local)

All data is stored locally in the xray state directory (see `xray paths`)
You can change this setting anytime in .xrayrc.json

Enable telemetry? [Y/n]:
```

### Design Rationale

**Clear and Informative:**
- Explains what data IS collected (positive framing)
- Explicitly states what IS NOT collected (addresses concerns)
- Shows where data is stored (transparency)
- Explains how to change setting later (flexibility)

**Default to Yes:**
- `[Y/n]` format means pressing Enter accepts (common UX pattern)
- But user must explicitly interact (no silent auto-accept)

**Short and Scannable:**
- Bullet points for easy scanning
- Key information highlighted
- No legal jargon

## Non-Interactive Detection

### CI/CD Environment Variables

The consent flow detects these CI environment variables:

```typescript
const ciEnvVars = [
  'CI',
  'CONTINUOUS_INTEGRATION',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'TRAVIS',
  'JENKINS_URL',
  'BUILDKITE',
  'TEAMCITY_VERSION'
];
```

If any are set, the prompt is skipped.

### TTY Detection

stdout not a TTY forces telemetry off (`telemetryOffReason` → `non-tty`),
even with saved consent; stdin not a TTY only skips the prompt.

This catches:
- Piped input: `echo "xray map" | bash`
- Piped output: `xray map | tee log.txt`
- Background execution: `xray map &`
- Cron jobs

### Default Behavior

In non-interactive mode:
- Consent prompt is **skipped**
- Telemetry is **off for the run**, even with saved consent
- Nothing is **saved** (the next interactive run uses or asks for the decision)

This ensures:
- CI/CD builds don't hang waiting for input
- Scripts don't break unexpectedly
- Privacy-first default in automated environments

## Flag Handling

### --no-telemetry Flag

**Added to:** `src/commands/common.ts`

```typescript
.option('--no-telemetry', 'Disable telemetry for this session')
```

**Precedence:**
- Highest priority (overrides everything)
- Checked first in consent flow
- Skips prompt and disables telemetry immediately

**Use Cases:**
- Quick one-off command: `xray map --no-telemetry`
- CI/CD override: Even if config says enabled
- Privacy-conscious users: Easy way to disable per-command

## Configuration Storage

### .xrayrc.json Format

```json
{
  "paths": ["./src"],
  "telemetry": {
    "enabled": true
  }
}
```

The `telemetry.enabled` field stores the user's decision.

### Config Creation

If no config exists, minimal config is created:

```json
{
  "paths": ["/current/working/directory"],
  "telemetry": {
    "enabled": false
  }
}
```

### Config Update

If config exists, only the `telemetry` field is updated:

```typescript
let config = loadConfig();
if (!config) {
  config = { paths: [process.cwd()] };
}
config.telemetry = { enabled };
saveConfig(config);
```

## Testing

### Test Coverage

**File:** `__tests__/lib/telemetry-consent.test.ts`

**19 tests passing, 1 skipped:**

1. **hasConsentDecision** (4 tests)
   - No config exists
   - Config with telemetry enabled
   - Config with telemetry disabled
   - Config without telemetry setting

2. **isTelemetryDisabledByFlag** (3 tests)
   - Flag present
   - Flag absent
   - Flag at different positions

3. **saveConsentDecision** (4 tests)
   - Create config if none exists
   - Update existing config
   - Save enabled=true
   - Save enabled=false

4. **handleFirstRunConsent** (6 tests)
   - --no-telemetry flag
   - Existing decision
   - Non-interactive mode (no TTY)
   - CI environment detection
   - Various CI env vars
   - Interactive prompt (skipped - hard to mock)

5. **Non-interactive detection** (2 tests)
   - Piped input
   - Piped output

6. **Flag precedence** (1 test)
   - --no-telemetry overrides config

### Running Tests

```bash
npm test -- __tests__/lib/telemetry-consent.test.ts
```

All tests pass except one skipped (interactive prompt is tested manually).

## Edge Cases

### Multiple Runs

**Scenario:** User runs xray multiple times in succession

**Behavior:**
- First interactive run: prompt appears, decision saved globally
- Subsequent runs, any project: no prompt, saved decision used

### Changing Decision

**Scenario:** User wants to change their telemetry preference

**Options:**
1. Edit the global `config.json` (or a project `.xrayrc.json` override) manually
2. Delete the global `config.json` and run again
3. Set `XRAY_TELEMETRY_ENABLED` environment variable
4. Use `--no-telemetry` flag for one-off disabling

### Deleted Config

**Scenario:** User deletes the global `config.json` after initial setup

**Behavior:**
- Next run: Prompt appears again (treated as first run)
- Previous telemetry data (`telemetry` in `xray paths`) is not deleted

### Conflicting Settings

**Scenario:** Config says enabled, but `--no-telemetry` flag used

**Precedence:**
1. `--no-telemetry` flag (highest)
2. Environment variable `XRAY_TELEMETRY_ENABLED`
3. Project config / `--config` `.xrayrc.json`, then global user config
4. Default (disabled)

## Future Enhancements

### Potential Improvements

1. **`xray telemetry` command** - Manage telemetry settings via CLI
   - `xray telemetry enable` - Enable telemetry
   - `xray telemetry disable` - Disable telemetry
   - `xray telemetry status` - Show current setting
   - `xray telemetry clear` - Clear collected data

2. **Consent expiration** - Re-prompt after X months
   - Respect ongoing consent
   - Keep users informed of changes

3. **Data anonymization** - Additional privacy measures
   - Hash identifiers
   - Aggregate stats only

4. **Telemetry dashboard** - Show collected data to user
   - Local web view of the telemetry file (`telemetry` in `xray paths`)
   - Statistics and charts

## Related Documentation

- [User Guide](../user/telemetry.md) - How to enable/disable telemetry
- [Developer Guide](telemetry.md) - Telemetry implementation details
- [Coverage Report](telemetry-coverage.md) - Command coverage
