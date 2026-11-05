// Mock tree-sitter and language-registry first to avoid native module loading
jest.mock('tree-sitter', () => {
    return jest.fn();
});

jest.mock('../src/lib/parser/language-registry', () => ({
    getLanguageConfig: jest.fn(),
    updateLanguageQuery: jest.fn()
}));

jest.mock('llm-cost', () => ({
    tokenizeAndEstimateCost: jest.fn().mockResolvedValue({ cost: 0 })
}));

// Mock dependencies
jest.mock('fs');
jest.mock('../src/lib/scanner');
jest.mock('../src/lib/parser/manager');
jest.mock('../src/lib/graph/builder');
jest.mock('../src/lib/graph/ranker');
jest.mock('../src/lib/renderer/map-renderer');
jest.mock('../src/lib/renderer/chunked-renderer');
jest.mock('../src/lib/cache/sqlite-cache');

import { Xray, XrayConfig } from '../src/lib/xray';
import { XrayEvents } from '../src/lib/events/types';
import * as fs from 'fs';

describe('Xray Event Integration', () => {
    let config: XrayConfig;
    let xray: Xray;

    beforeEach(() => {
        config = {
            path: '/test/project',
            // fs is mocked here, so the on-disk cache location can't be resolved.
            cachePath: ':memory:'
        };

        // Mock file system
        (fs.statSync as jest.Mock).mockReturnValue({
            mtimeMs: Date.now()
        });
        (fs.readFileSync as jest.Mock).mockReturnValue('const x = 1;');

        jest.clearAllMocks();
    });

    describe('AsyncEventEmitter extension', () => {
        it('should extend AsyncEventEmitter', () => {
            xray = new Xray(config);

            // Check that xray has event emitter methods
            expect(typeof xray.on).toBe('function');
            expect(typeof xray.once).toBe('function');
            expect(typeof xray.off).toBe('function');
        });

        it('should support on() for registering event listeners', () => {
            xray = new Xray(config);
            const listener = jest.fn();

            xray.on('scan:start', listener);

            expect(xray.listenerCount('scan:start')).toBe(1);
        });

        it('should support once() for one-time listeners', async () => {
            xray = new Xray(config);
            const listener = jest.fn();

            xray.once('scan:start', listener);

            // Emit twice
            await xray.emitAsync('scan:start', {
                path: '/test',
                config: { path: '/test' }
            });
            await xray.emitAsync('scan:start', {
                path: '/test',
                config: { path: '/test' }
            });

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should support off() for removing listeners', async () => {
            xray = new Xray(config);
            const listener = jest.fn();

            xray.on('scan:start', listener);
            xray.off('scan:start', listener);

            await xray.emitAsync('scan:start', {
                path: '/test',
                config: { path: '/test' }
            });

            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('plugin methods', () => {
        it('should have use() method for registering plugins', () => {
            xray = new Xray(config);
            expect(typeof xray.use).toBe('function');
        });

        it('should have unload() method for removing plugins', () => {
            xray = new Xray(config);
            expect(typeof xray.unload).toBe('function');
        });

        it('should have plugins() method for listing plugins', () => {
            xray = new Xray(config);
            expect(typeof xray.plugins).toBe('function');
        });

        it('should return empty array initially from plugins()', () => {
            xray = new Xray(config);
            const plugins = xray.plugins();
            expect(Array.isArray(plugins)).toBe(true);
            expect(plugins.length).toBe(0);
        });

        it('should register and list plugins', async () => {
            xray = new Xray(config);

            const plugin = {
                name: 'test-plugin',
                apply: jest.fn()
            };

            await xray.use(plugin);

            const plugins = xray.plugins();
            expect(plugins).toHaveLength(1);
            expect(plugins[0].name).toBe('test-plugin');
        });

        it('should return this from use() for chaining', async () => {
            xray = new Xray(config);

            const plugin = {
                name: 'test-plugin',
                apply: jest.fn()
            };

            const result = await xray.use(plugin);
            expect(result).toBe(xray);
        });

        it('should return this from unload() for chaining', async () => {
            xray = new Xray(config);

            const plugin = {
                name: 'test-plugin',
                apply: jest.fn()
            };

            await xray.use(plugin);
            const result = await xray.unload('test-plugin');
            expect(result).toBe(xray);
        });
    });

    describe('backward compatibility with onProgress', () => {
        it('should support onProgress callback', () => {
            const onProgress = jest.fn();

            xray = new Xray({
                path: '/test',
                cachePath: ':memory:',
                onProgress
            });

            expect(xray).toBeDefined();
        });

        it('should convert onProgress to progress event listener', async () => {
            const onProgress = jest.fn();

            xray = new Xray({
                path: '/test',
                cachePath: ':memory:',
                onProgress
            });

            // Emit progress event
            await xray.emitAsync('progress', {
                stage: 'parsing',
                current: 5,
                total: 10,
                message: 'Parsing files'
            });

            expect(onProgress).toHaveBeenCalledWith(5, 10, 'Parsing files');
        });

        it('should work without onProgress callback', () => {
            xray = new Xray({
                cachePath: ':memory:',
                path: '/test'
            });

            expect(xray).toBeDefined();
            expect(xray.listenerCount('progress')).toBe(0);
        });
    });

    describe('type safety', () => {
        it('should provide type-safe event names', () => {
            xray = new Xray(config);

            // These should compile without errors
            const scanListener = (event: XrayEvents['scan:start']) => {
                expect(event.path).toBeDefined();
                expect(event.config).toBeDefined();
            };

            const progressListener = (event: XrayEvents['progress']) => {
                expect(event.stage).toBeDefined();
                expect(event.current).toBeDefined();
                expect(event.total).toBeDefined();
                expect(event.message).toBeDefined();
            };

            xray.on('scan:start', scanListener);
            xray.on('progress', progressListener);
        });

        it('should provide type-safe event payloads', async () => {
            xray = new Xray(config);
            const listener = jest.fn();

            xray.on('cache:hit', listener);

            await xray.emitAsync('cache:hit', {
                file: 'test.ts',
                tags: [],
                imports: []
            });

            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    file: 'test.ts',
                    tags: expect.any(Array),
                    imports: expect.any(Array)
                })
            );
        });
    });

    describe('event emission', () => {
        it('should allow async event handlers', async () => {
            xray = new Xray(config);
            const results: number[] = [];

            xray.on('scan:start', async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                results.push(1);
            });

            xray.on('scan:start', async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                results.push(2);
            });

            await xray.emitAsync('scan:start', {
                path: '/test',
                config: { path: '/test' }
            });

            expect(results).toEqual([1, 2]);
        });

        it('should support parallel event emission', async () => {
            xray = new Xray(config);
            const startTime = Date.now();

            xray.on('progress', async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
            });

            xray.on('progress', async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
            });

            await xray.emitAsyncParallel('progress', {
                stage: 'test',
                current: 1,
                total: 10,
                message: 'Testing'
            });

            const elapsed = Date.now() - startTime;

            // Should take ~50ms (parallel), not ~100ms (sequential)
            expect(elapsed).toBeLessThan(100);
        });

        it('should isolate listener errors', async () => {
            xray = new Xray(config);
            const listener1 = jest.fn();
            const listener3 = jest.fn();

            xray.on('scan:start', listener1);
            xray.on('scan:start', async () => {
                throw new Error('Listener error');
            });
            xray.on('scan:start', listener3);

            const errorHandler = jest.fn();
            xray.on('error', errorHandler);

            await xray.emitAsync('scan:start', {
                path: '/test',
                config: { path: '/test' }
            });

            expect(listener1).toHaveBeenCalled();
            expect(listener3).toHaveBeenCalled();
            expect(errorHandler).toHaveBeenCalled();
        });
    });
});
