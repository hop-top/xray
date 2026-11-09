import {
  aliasTargetErrors, circularAliases, splitAliasTarget, usableAliases,
} from '../../src/lib/alias-resolver';
import { Logger } from '../../src/lib/logger';
import { XrayConfig } from '../../src/types/xray-config';

describe('alias rules', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const warned = () => warnSpy.mock.calls.map(c => c[0]).join('\n');

  describe('splitAliasTarget', () => {
    it('splits strategy and command', () => {
      expect(splitAliasTarget('react components'))
        .toEqual({ strategyName: 'react', commandName: 'components' });
    });

    it('keeps multi-word command names', () => {
      expect(splitAliasTarget('rest-api list endpoints'))
        .toEqual({ strategyName: 'rest-api', commandName: 'list endpoints' });
    });
  });

  describe('usableAliases', () => {
    it('returns all valid aliases', () => {
      const config: XrayConfig = {
        aliases: { comp: 'react components', routes: 'express routes' },
      };
      expect(usableAliases(config, [])).toEqual({
        comp: 'react components', routes: 'express routes',
      });
    });

    it('returns empty map when no aliases configured', () => {
      expect(usableAliases({}, [])).toEqual({});
    });

    it('skips aliases that conflict with built-in commands', () => {
      const aliases = usableAliases({
        aliases: { map: 'react components', comp: 'react components' },
      }, ['map']);
      expect(aliases).toEqual({ comp: 'react components' });
      expect(warned()).toContain('Alias "map" conflicts with built-in command, skipping');
    });

    it('skips aliases with invalid target format', () => {
      const aliases = usableAliases({
        aliases: { bad: 'invalidformat', good: 'react components' },
      }, []);
      expect(aliases).toEqual({ good: 'react components' });
      expect(warned()).toContain('Invalid alias target "invalidformat" for "bad"');
    });

    it('skips empty names and names containing whitespace', () => {
      const aliases = usableAliases({
        aliases: { '': 'react components', 'a b': 'react components', 'a b': 'react components' },
      }, []);
      expect(aliases).toEqual({});
      expect(warned()).toContain('Invalid alias name "a b"');
    });
  });

  describe('aliasTargetErrors', () => {
    const strategies = [
      { name: 'react', commands: { components: { description: '', handler: jest.fn() } } } as any,
    ];

    it('reports unknown strategies and commands', () => {
      expect(aliasTargetErrors(
        { comp: 'react components', hooks: 'react hooks', w: 'vue widgets' },
        strategies,
      )).toEqual([
        'Alias "hooks" targets unknown command "hooks" in strategy "react"',
        'Alias "w" targets unknown strategy "vue"',
      ]);
    });
  });

  describe('circularAliases', () => {
    it('detects circular aliases', () => {
      expect(circularAliases({ a: 'b commands', b: 'a commands' })).toEqual(['a', 'b']);
    });

    it('detects nothing for valid aliases', () => {
      expect(circularAliases({ comp: 'react components', routes: 'express routes' }))
        .toHaveLength(0);
    });

    it('detects multi-level circular references', () => {
      expect(circularAliases({ b: 'c commands', c: 'a commands', a: 'b commands' }))
        .toEqual(['a', 'b', 'c']);
    });
  });
});
