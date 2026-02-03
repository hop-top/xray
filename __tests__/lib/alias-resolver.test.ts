import { AliasResolver } from '../../src/lib/alias-resolver';
import { XrayConfig } from '../../src/types/xray-config';
import { StrategyLoader } from '../../src/lib/strategy/loader';

describe('AliasResolver', () => {
  describe('resolve', () => {
    it('should resolve valid aliases', () => {
      const config: XrayConfig = {
        aliases: { comp: 'react components' }
      };
      const resolver = new AliasResolver(config);

      const result = resolver.resolve('comp');

      expect(result.isAlias).toBe(true);
      expect(result.target).toBe('react components');
      expect(result.strategyName).toBe('react');
      expect(result.commandName).toBe('components');
    });

    it('should return isAlias=false for non-aliases', () => {
      const resolver = new AliasResolver({});
      const result = resolver.resolve('unknown');

      expect(result.isAlias).toBe(false);
      expect(result.target).toBeUndefined();
    });

    it('should handle multi-word command names', () => {
      const config: XrayConfig = {
        aliases: { api: 'rest-api list endpoints' }
      };
      const resolver = new AliasResolver(config);

      const result = resolver.resolve('api');

      expect(result.isAlias).toBe(true);
      expect(result.strategyName).toBe('rest-api');
      expect(result.commandName).toBe('list endpoints');
    });
  });

  describe('isAlias', () => {
    it('should return true for configured aliases', () => {
      const config: XrayConfig = {
        aliases: { comp: 'react components' }
      };
      const resolver = new AliasResolver(config);

      expect(resolver.isAlias('comp')).toBe(true);
    });

    it('should return false for non-aliases', () => {
      const resolver = new AliasResolver({});

      expect(resolver.isAlias('unknown')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all configured aliases', () => {
      const config: XrayConfig = {
        aliases: {
          comp: 'react components',
          routes: 'express routes'
        }
      };
      const resolver = new AliasResolver(config);

      const aliases = resolver.getAll();

      expect(aliases.size).toBe(2);
      expect(aliases.get('comp')).toBe('react components');
      expect(aliases.get('routes')).toBe('express routes');
    });

    it('should return empty map when no aliases configured', () => {
      const resolver = new AliasResolver({});

      const aliases = resolver.getAll();

      expect(aliases.size).toBe(0);
    });
  });

  describe('validation', () => {
    it('should skip aliases that conflict with built-in commands', () => {
      const config: XrayConfig = {
        aliases: {
          map: 'react components',
          comp: 'react components'
        }
      };
      const resolver = new AliasResolver(config);

      const aliases = resolver.getAll();

      expect(aliases.size).toBe(1);
      expect(aliases.has('map')).toBe(false);
      expect(aliases.has('comp')).toBe(true);
    });

    it('should skip aliases with invalid target format', () => {
      const config: XrayConfig = {
        aliases: {
          bad: 'invalidformat',
          good: 'react components'
        }
      };
      const resolver = new AliasResolver(config);

      const aliases = resolver.getAll();

      expect(aliases.size).toBe(1);
      expect(aliases.has('bad')).toBe(false);
      expect(aliases.has('good')).toBe(true);
    });
  });

  describe('detectCircular', () => {
    it('should detect circular aliases', () => {
      const config: XrayConfig = {
        aliases: {
          a: 'b commands',
          b: 'a commands'
        }
      };
      const resolver = new AliasResolver(config);

      const circular = resolver.detectCircular();

      expect(circular).toContain('a');
      expect(circular).toContain('b');
    });

    it('should not detect circular for valid aliases', () => {
      const config: XrayConfig = {
        aliases: {
          comp: 'react components',
          routes: 'express routes'
        }
      };
      const resolver = new AliasResolver(config);

      const circular = resolver.detectCircular();

      expect(circular).toHaveLength(0);
    });

    it('should detect multi-level circular references', () => {
      const config: XrayConfig = {
        aliases: {
          a: 'b commands',
          b: 'c commands',
          c: 'a commands'
        }
      };
      const resolver = new AliasResolver(config);

      const circular = resolver.detectCircular();

      expect(circular.length).toBeGreaterThan(0);
    });
  });
});
