import { Xray } from '../../src/lib/xray';
import { SanitizerPlugin } from '../../examples/plugins/sanitizer';
import { Tag } from '../../src/lib/parser/types';

describe('SanitizerPlugin', () => {
  let xray: Xray;

  beforeEach(() => {
    xray = new Xray({
      path: '/tmp/test',
      cachePath: ':memory:'
    });
  });

  describe('plugin metadata', () => {
    it('should have correct name', () => {
      const plugin = new SanitizerPlugin();
      expect(plugin.name).toBe('sanitizer');
    });

    it('should have version', () => {
      const plugin = new SanitizerPlugin();
      expect(plugin.version).toBeDefined();
    });
  });

  describe('default patterns', () => {
    it('should use default patterns when none provided', () => {
      const plugin = new SanitizerPlugin();
      expect(plugin['patterns']).toHaveLength(3);
    });

    it('should redact Bearer tokens', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const event = {
        file: 'test.ts',
        content: 'const token = "Bearer abc123xyz456";',
        skip: false
      };

      await xray.emitAsync('parse:before', event);

      expect(event.content).toContain('Bearer [REDACTED]');
      expect(event.content).not.toContain('abc123xyz456');
    });

    it('should redact API keys', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const event = {
        file: 'test.ts',
        content: 'const key = api_key: "sk_live_1234567890abcdefghij";',
        skip: false
      };

      await xray.emitAsync('parse:before', event);

      expect(event.content).toContain('api_key: "[REDACTED]"');
      expect(event.content).not.toContain('sk_live_1234567890abcdefghij');
    });

    it('should redact passwords', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const event = {
        file: 'test.ts',
        content: 'const creds = { password: "secretPass123" };',
        skip: false
      };

      await xray.emitAsync('parse:before', event);

      expect(event.content).toContain('password: "[REDACTED]"');
      expect(event.content).not.toContain('secretPass123');
    });
  });

  describe('custom patterns', () => {
    it('should accept custom patterns', async () => {
      const plugin = new SanitizerPlugin([
        { pattern: /SECRET_[A-Z_]+/g, replacement: 'SECRET_[HIDDEN]' }
      ]);
      await xray.use(plugin);

      const event = {
        file: 'test.ts',
        content: 'const secret = SECRET_API_KEY;',
        skip: false
      };

      await xray.emitAsync('parse:before', event);

      expect(event.content).toContain('SECRET_[HIDDEN]');
      expect(event.content).not.toContain('SECRET_API_KEY');
    });

    it('should support multiple custom patterns', async () => {
      const plugin = new SanitizerPlugin([
        { pattern: /SSN:\s*\d{3}-\d{2}-\d{4}/g, replacement: 'SSN: [REDACTED]' },
        { pattern: /credit_card:\s*\d{16}/g, replacement: 'credit_card: [REDACTED]' }
      ]);
      await xray.use(plugin);

      const event = {
        file: 'test.ts',
        content: 'SSN: 123-45-6789 and credit_card: 1234567890123456',
        skip: false
      };

      await xray.emitAsync('parse:before', event);

      expect(event.content).toContain('SSN: [REDACTED]');
      expect(event.content).toContain('credit_card: [REDACTED]');
      expect(event.content).not.toContain('123-45-6789');
      expect(event.content).not.toContain('1234567890123456');
    });
  });

  describe('parse:before content sanitization', () => {
    it('should sanitize file content before parsing', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const event = {
        file: 'config.ts',
        content: `
          const config = {
            apiKey: "sk_live_abcdefghijklmnopqrst",
            password: "mySecretPass",
            token: "Bearer xyz123456789"
          };
        `,
        skip: false
      };

      await xray.emitAsync('parse:before', event);

      expect(event.content).not.toContain('sk_live_abcdefghijklmnopqrst');
      expect(event.content).not.toContain('mySecretPass');
      expect(event.content).not.toContain('xyz123456789');
      expect(event.content).toContain('[REDACTED]');
    });

    it('should handle content with no sensitive data', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const originalContent = 'const x = 42; function add(a, b) { return a + b; }';
      const event = {
        file: 'utils.ts',
        content: originalContent,
        skip: false
      };

      await xray.emitAsync('parse:before', event);

      expect(event.content).toBe(originalContent);
    });

    it('should apply all patterns to content', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const event = {
        file: 'auth.ts',
        content: `
          Bearer token123
          api_key: "key456789012345678901"
          password: "pass789"
        `,
        skip: false
      };

      await xray.emitAsync('parse:before', event);

      const redactedCount = (event.content.match(/\[REDACTED\]/g) || []).length;
      expect(redactedCount).toBe(3);
    });
  });

  describe('parse:after docstring sanitization', () => {
    it('should sanitize docstrings in tags', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const tags: Tag[] = [
        {
          file: 'test.ts',
          name: 'authenticate',
          kind: 'function',
          line: 1,
          col: 0,
          doc: 'Uses Bearer token123 for authentication'
        }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(event.tags[0].doc).toContain('Bearer [REDACTED]');
      expect(event.tags[0].doc).not.toContain('token123');
    });

    it('should handle tags without docstrings', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const tags: Tag[] = [
        {
          file: 'test.ts',
          name: 'myFunc',
          kind: 'function',
          line: 1,
          col: 0
        }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(event.tags[0].doc).toBeUndefined();
    });

    it('should sanitize multiple tags', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const tags: Tag[] = [
        {
          file: 'test.ts',
          name: 'func1',
          kind: 'function',
          line: 1,
          col: 0,
          doc: 'API key: "sk_live_12345678901234567890"'
        },
        {
          file: 'test.ts',
          name: 'func2',
          kind: 'function',
          line: 10,
          col: 0,
          doc: 'Password: "secret123"'
        }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(event.tags[0].doc).toContain('[REDACTED]');
      expect(event.tags[1].doc).toContain('[REDACTED]');
      expect(event.tags[0].doc).not.toContain('sk_live_12345678901234567890');
      expect(event.tags[1].doc).not.toContain('secret123');
    });

    it('should apply multiple patterns to docstrings', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const tags: Tag[] = [
        {
          file: 'test.ts',
          name: 'auth',
          kind: 'function',
          line: 1,
          col: 0,
          doc: 'Bearer token123, api_key: "key12345678901234567890", password: "pass456"'
        }
      ];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      const redactedCount = (event.tags[0].doc!.match(/\[REDACTED\]/g) || []).length;
      expect(redactedCount).toBe(3);
    });
  });

  describe('pattern matching', () => {
    it('should handle Bearer tokens with various formats', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const testCases = [
        'Bearer abc123',
        'Bearer abc-123',
        'Bearer abc_123',
        'Bearer abc.123',
        'Bearer abc~123',
        'Bearer abc+123',
        'Bearer abc/123',
        'Bearer abc123=='
      ];

      for (const testCase of testCases) {
        const event = { file: 'test.ts', content: testCase, skip: false };
        await xray.emitAsync('parse:before', event);
        expect(event.content).toBe('Bearer [REDACTED]');
      }
    });

    it('should handle API keys with various prefixes', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const testCases = [
        'apikey: "sk_12345678901234567890"',
        'api_key: "pk_12345678901234567890"',
        'api-key: "key1234567890123456789"',
        'API_KEY="test12345678901234567890"'
      ];

      for (const testCase of testCases) {
        const event = { file: 'test.ts', content: testCase, skip: false };
        await xray.emitAsync('parse:before', event);
        expect(event.content).toContain('[REDACTED]');
      }
    });

    it('should be case-insensitive for API keys and passwords', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const event1 = { file: 'test.ts', content: 'API_KEY: "key12345678901234567890"', skip: false };
      await xray.emitAsync('parse:before', event1);
      expect(event1.content).toContain('[REDACTED]');

      const event2 = { file: 'test.ts', content: 'PASSWORD: "secret123"', skip: false };
      await xray.emitAsync('parse:before', event2);
      expect(event2.content).toContain('[REDACTED]');
    });
  });

  describe('plugin lifecycle', () => {
    it('should register successfully with xray', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const plugins = xray.plugins();
      expect(plugins).toContainEqual(plugin);
    });

    it('should work with both parse:before and parse:after', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      // parse:before
      const contentEvent = {
        file: 'test.ts',
        content: 'Bearer token123',
        skip: false
      };
      await xray.emitAsync('parse:before', contentEvent);
      expect(contentEvent.content).toContain('[REDACTED]');

      // parse:after
      const tags: Tag[] = [{
        file: 'test.ts',
        name: 'func',
        kind: 'function',
        line: 1,
        col: 0,
        doc: 'password: "secret"'
      }];
      const tagEvent = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', tagEvent);
      expect(tagEvent.tags[0].doc).toContain('[REDACTED]');
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const event = { file: 'empty.ts', content: '', skip: false };
      await xray.emitAsync('parse:before', event);
      expect(event.content).toBe('');
    });

    it('should handle empty tag array', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const event = { file: 'test.ts', tags: [], imports: [] };
      await xray.emitAsync('parse:after', event);
      expect(event.tags).toEqual([]);
    });

    it('should preserve tag structure while sanitizing docs', async () => {
      const plugin = new SanitizerPlugin();
      await xray.use(plugin);

      const tags: Tag[] = [{
        file: 'test.ts',
        name: 'myFunc',
        kind: 'function',
        line: 5,
        col: 2,
        signature: '() => void',
        doc: 'Bearer token'
      }];

      const event = { file: 'test.ts', tags, imports: [] };
      await xray.emitAsync('parse:after', event);

      expect(event.tags[0].name).toBe('myFunc');
      expect(event.tags[0].kind).toBe('function');
      expect(event.tags[0].line).toBe(5);
      expect(event.tags[0].col).toBe(2);
      expect(event.tags[0].signature).toBe('() => void');
      expect(event.tags[0].doc).toContain('[REDACTED]');
    });
  });
});
