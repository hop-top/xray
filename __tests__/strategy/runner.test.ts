// tests/strategy/runner.test.ts
import { StrategyRunner } from '../../src/lib/strategy/runner';
import { Strategy, StrategyContext, FileMetadata } from '../../src/lib/strategy/types';

// Mock strategy for testing
class MockStrategy implements Strategy {
  name = 'mock';
  version = '1.0.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
    return true;
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    return {
      tags: [],
      exports: [],
      imports: [],
      metadata: {}
    };
  }

  commands = {
    'test-command': {
      description: 'A test command',
      async handler(ctx: StrategyContext, opts?: any) {
        return { success: true, message: 'Test command executed', opts };
      }
    },
    'another-command': {
      description: 'Another test command',
      async handler(ctx: StrategyContext, opts?: any) {
        return { data: 'Another command result' };
      }
    }
  };
}

// Mock strategy without commands
class NoCommandsStrategy implements Strategy {
  name = 'no-commands';
  version = '1.0.0';

  async detect(ctx: StrategyContext): Promise<boolean> {
    return true;
  }

  async analyze(file: string, ctx: StrategyContext): Promise<FileMetadata> {
    return {
      tags: [],
      exports: [],
      imports: [],
      metadata: {}
    };
  }
}

// Mock context
const mockContext: StrategyContext = {
  hasDependency: () => false,
  hasDevDependency: () => false,
  hasFiles: () => false,
  parseAST: async () => ({}),
  readFile: async () => '',
  findFiles: async () => [],
  hasTag: () => false,
  getTags: () => [],
  getMetadata: () => ({}),
  getCached: () => undefined,
  setCached: () => {},
  globFiles: () => [],
  getProjectRoot: () => '/test',
  getConfig: () => undefined,
  getExtensionConfig: () => undefined
};

describe('StrategyRunner', () => {
  let runner: StrategyRunner;
  let mockStrategy: MockStrategy;
  let noCommandsStrategy: NoCommandsStrategy;

  beforeEach(() => {
    runner = new StrategyRunner();
    mockStrategy = new MockStrategy();
    noCommandsStrategy = new NoCommandsStrategy();
  });

  describe('register', () => {
    it('should register a strategy', () => {
      runner.register(mockStrategy);
      expect(runner.getRegisteredStrategies()).toContain('mock');
    });

    it('should register multiple strategies', () => {
      runner.register(mockStrategy);
      runner.register(noCommandsStrategy);

      const strategies = runner.getRegisteredStrategies();
      expect(strategies).toContain('mock');
      expect(strategies).toContain('no-commands');
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      runner.register(mockStrategy);
    });

    it('should execute a command successfully', async () => {
      const result = await runner.execute('mock', 'test-command', mockContext);

      expect(result).toEqual({
        success: true,
        message: 'Test command executed',
        opts: undefined
      });
    });

    it('should pass options to command handler', async () => {
      const options = { verbose: true, filter: 'test' };
      const result = await runner.execute('mock', 'test-command', mockContext, options);

      expect(result.opts).toEqual(options);
    });

    it('should execute different commands', async () => {
      const result = await runner.execute('mock', 'another-command', mockContext);

      expect(result).toEqual({ data: 'Another command result' });
    });

    it('should throw error for unknown strategy', async () => {
      await expect(
        runner.execute('unknown', 'test-command', mockContext)
      ).rejects.toThrow('Strategy "unknown" not found');
    });

    it('should throw error for unknown command', async () => {
      await expect(
        runner.execute('mock', 'unknown-command', mockContext)
      ).rejects.toThrow('Command "unknown-command" not found for strategy "mock"');
    });

    it('should throw error when strategy has no commands', async () => {
      runner.register(noCommandsStrategy);

      await expect(
        runner.execute('no-commands', 'any-command', mockContext)
      ).rejects.toThrow('Command "any-command" not found for strategy "no-commands"');
    });
  });

  describe('listCommands', () => {
    beforeEach(() => {
      runner.register(mockStrategy);
      runner.register(noCommandsStrategy);
    });

    it('should list all commands for a strategy', () => {
      const commands = runner.listCommands('mock');

      expect(commands).toHaveLength(2);
      expect(commands).toEqual(expect.arrayContaining([
        { name: 'test-command', description: 'A test command' },
        { name: 'another-command', description: 'Another test command' }
      ]));
    });

    it('should return empty array for strategy without commands', () => {
      const commands = runner.listCommands('no-commands');

      expect(commands).toEqual([]);
    });

    it('should throw error for unknown strategy', () => {
      expect(() => runner.listCommands('unknown')).toThrow('Strategy "unknown" not found');
    });
  });

  describe('hasCommands', () => {
    beforeEach(() => {
      runner.register(mockStrategy);
      runner.register(noCommandsStrategy);
    });

    it('should return true for strategy with commands', () => {
      expect(runner.hasCommands('mock')).toBe(true);
    });

    it('should return false for strategy without commands', () => {
      expect(runner.hasCommands('no-commands')).toBe(false);
    });

    it('should return false for unknown strategy', () => {
      expect(runner.hasCommands('unknown')).toBe(false);
    });
  });

  describe('getRegisteredStrategies', () => {
    it('should return empty array when no strategies registered', () => {
      expect(runner.getRegisteredStrategies()).toEqual([]);
    });

    it('should return all registered strategy names', () => {
      runner.register(mockStrategy);
      runner.register(noCommandsStrategy);

      const strategies = runner.getRegisteredStrategies();
      expect(strategies).toHaveLength(2);
      expect(strategies).toContain('mock');
      expect(strategies).toContain('no-commands');
    });
  });
});
