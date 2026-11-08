# Xray Extension System

Xray features a first-class extension system that allows adding new capabilities
to the tool. Every dynamic capability in Xray, including built-in strategies,
is powered by this extension system.

## Extension Contract

Every dynamic capability is normalized into an `Extension` shape before xray
detects it or registers its commands.

```typescript
interface Extension {
  id: string;
  name: string;
  version: string;
  surface: 'strategy' | 'glossary' | 'command' | string;
  detect(ctx: StrategyContext): Promise<boolean | ExtensionDetection> | boolean;
  fileTypes?(): string[];
  ignorePatterns?(): string[];
  analyze?(file: string, ctx: StrategyContext): Promise<FileMetadata>;
  commands?: Record<string, StrategyCommand>;
  strategy?: Strategy;
}
```

### Key Surfaces

- **`strategy`**: Classic project type detection and auto-configuration.
- **`glossary`**: Custom project dictionaries and symbol mappings.
- **`command`**: Command-only extensions that provide CLI functionality.

## Extension Config and Runtime Overrides

Extension config is merged with this precedence:

1. Global config
2. Project config
3. Runtime overrides

### Configuration Bag

The shared config bag lives under `extensions.<name>`:

```typescript
interface XrayExtensionConfig {
  enabled?: boolean;
  threshold?: number;
  hints?: string[];
  enabledSurfaces?: Record<string, boolean>;
  config?: Record<string, unknown>;
}
```

### Runtime Override Flags

Runtime overrides are available on analysis commands and dynamic extension
commands:

```bash
xray map --enable-extension glossary
xray map --extension-threshold glossary=0.85
xray map --extension-hint glossary=domain-term
xray map --enable-surface glossary:detect
xray react components --disable-surface glossary:export
```

## Strategy Context API

Extensions interact with Xray via the `StrategyContext`:

```typescript
interface StrategyContext {
  // Check for dependencies
  hasDependency(name: string): boolean;
  hasDevDependency(name: string): boolean;

  // File operations
  hasFiles(pattern: string): boolean;
  globFiles(pattern: string): string[];
  readFile(file: string): Promise<string>;
  findFiles(query: FileQuery): Promise<string[]>;

  // Metadata and tags
  hasTag(file: string, tag: string): boolean;
  getTags(file: string): string[];
  getMetadata(file: string, strategy: string): any;

  // Caching
  getCached(key: string): any;
  setCached(key: string, value: any): void;

  // Project info
  getProjectRoot(): string;
  getConfig(key: string): any;
  getExtensionConfig(name: string): XrayExtensionConfig | undefined;
}
```

## Related Documentation

- [Strategies README](../../strategies/README.md) - Documentation for the `strategy` surface and built-in strategies.
- [Architecture Guide](./architecture.md) - System design and internals.
