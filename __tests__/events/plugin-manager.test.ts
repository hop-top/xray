import { PluginManager, XrayPlugin } from '../../src/lib/events/plugin';
import { AsyncEventEmitter } from '../../src/lib/events/async-emitter';
import { XrayEvents } from '../../src/lib/events/types';
import { Logger } from '../../src/lib/logger';

// Mock Xray class for testing
class MockXray extends AsyncEventEmitter<XrayEvents> {
    private _stashes = new Map<string, unknown[]>();
    getLastGraph() {
        return {};
    }
    stash(namespace: string, items: unknown[]): void {
        const bucket = this._stashes.get(namespace);
        if (bucket) bucket.push(...items);
        else this._stashes.set(namespace, [...items]);
    }
    retrieve(namespace: string, n?: number): unknown[] {
        const bucket = this._stashes.get(namespace);
        if (!bucket) return [];
        return n === undefined ? bucket.slice() : bucket.slice(0, n);
    }
}

describe('PluginManager', () => {
    let manager: PluginManager;
    let mockXray: MockXray;

    beforeEach(() => {
        manager = new PluginManager();
        mockXray = new MockXray();
    });

    describe('plugin registration', () => {
        it('should register a plugin', async () => {
            const plugin: XrayPlugin = {
                name: 'test-plugin',
                version: '1.0.0',
                apply: jest.fn()
            };

            await manager.register(plugin, mockXray);

            expect(plugin.apply).toHaveBeenCalledWith(mockXray);
            expect(manager.has('test-plugin')).toBe(true);
        });

        it('should call plugin apply method with xray instance', async () => {
            const applyFn = jest.fn();
            const plugin: XrayPlugin = {
                name: 'test-plugin',
                apply: applyFn
            };

            await manager.register(plugin, mockXray);

            expect(applyFn).toHaveBeenCalledTimes(1);
            expect(applyFn).toHaveBeenCalledWith(mockXray);
        });

        it('should support async apply method', async () => {
            const plugin: XrayPlugin = {
                name: 'async-plugin',
                apply: async (xray) => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                    xray.on('progress', () => {});
                }
            };

            await manager.register(plugin, mockXray);

            expect(manager.has('async-plugin')).toBe(true);
            expect(mockXray.listenerCount('progress')).toBe(1);
        });

        it('should prevent duplicate plugin registration', async () => {
            const plugin: XrayPlugin = {
                name: 'duplicate-plugin',
                apply: jest.fn()
            };

            await manager.register(plugin, mockXray);

            await expect(manager.register(plugin, mockXray))
                .rejects.toThrow('Plugin "duplicate-plugin" already registered');
        });

        it('should allow different plugins with different names', async () => {
            const plugin1: XrayPlugin = {
                name: 'plugin-1',
                apply: jest.fn()
            };

            const plugin2: XrayPlugin = {
                name: 'plugin-2',
                apply: jest.fn()
            };

            await manager.register(plugin1, mockXray);
            await manager.register(plugin2, mockXray);

            expect(manager.has('plugin-1')).toBe(true);
            expect(manager.has('plugin-2')).toBe(true);
        });
    });

    describe('plugin unregistration', () => {
        it('should unregister a plugin', async () => {
            const plugin: XrayPlugin = {
                name: 'test-plugin',
                apply: jest.fn()
            };

            await manager.register(plugin, mockXray);
            expect(manager.has('test-plugin')).toBe(true);

            await manager.unregister('test-plugin');
            expect(manager.has('test-plugin')).toBe(false);
        });

        it('should call dispose method if provided', async () => {
            const disposeFn = jest.fn();
            const plugin: XrayPlugin = {
                name: 'disposable-plugin',
                apply: jest.fn(),
                dispose: disposeFn
            };

            await manager.register(plugin, mockXray);
            await manager.unregister('disposable-plugin');

            expect(disposeFn).toHaveBeenCalledTimes(1);
        });

        it('should support async dispose method', async () => {
            const disposeFn = jest.fn(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
            });

            const plugin: XrayPlugin = {
                name: 'async-disposable',
                apply: jest.fn(),
                dispose: disposeFn
            };

            await manager.register(plugin, mockXray);
            await manager.unregister('async-disposable');

            expect(disposeFn).toHaveBeenCalled();
            expect(manager.has('async-disposable')).toBe(false);
        });

        it('should throw error when unregistering non-existent plugin', async () => {
            await expect(manager.unregister('non-existent'))
                .rejects.toThrow('Plugin "non-existent" not found');
        });

        it('should work without dispose method', async () => {
            const plugin: XrayPlugin = {
                name: 'no-dispose',
                apply: jest.fn()
            };

            await manager.register(plugin, mockXray);
            await manager.unregister('no-dispose');

            expect(manager.has('no-dispose')).toBe(false);
        });
    });

    describe('plugin listing', () => {
        it('should list all registered plugins', async () => {
            const plugin1: XrayPlugin = {
                name: 'plugin-1',
                version: '1.0.0',
                apply: jest.fn()
            };

            const plugin2: XrayPlugin = {
                name: 'plugin-2',
                version: '2.0.0',
                apply: jest.fn()
            };

            await manager.register(plugin1, mockXray);
            await manager.register(plugin2, mockXray);

            const plugins = manager.list();

            expect(plugins).toHaveLength(2);
            expect(plugins).toContainEqual(plugin1);
            expect(plugins).toContainEqual(plugin2);
        });

        it('should return empty array when no plugins registered', () => {
            const plugins = manager.list();
            expect(plugins).toEqual([]);
        });

        it('should return shallow copy of plugins array', async () => {
            const plugin: XrayPlugin = {
                name: 'test-plugin',
                apply: jest.fn()
            };

            await manager.register(plugin, mockXray);

            const plugins1 = manager.list();
            const plugins2 = manager.list();

            expect(plugins1).toEqual(plugins2);
            expect(plugins1).not.toBe(plugins2); // Different array instances
        });
    });

    describe('plugin existence check', () => {
        it('should check if plugin exists by name', async () => {
            const plugin: XrayPlugin = {
                name: 'test-plugin',
                apply: jest.fn()
            };

            expect(manager.has('test-plugin')).toBe(false);

            await manager.register(plugin, mockXray);
            expect(manager.has('test-plugin')).toBe(true);

            await manager.unregister('test-plugin');
            expect(manager.has('test-plugin')).toBe(false);
        });

        it('should return false for non-existent plugins', () => {
            expect(manager.has('non-existent')).toBe(false);
        });
    });

    describe('plugin lifecycle integration', () => {
        it('should allow plugin to attach event listeners', async () => {
            const listener = jest.fn();
            const plugin: XrayPlugin = {
                name: 'listener-plugin',
                apply: (xray) => {
                    xray.on('scan:start', listener);
                }
            };

            await manager.register(plugin, mockXray);

            await mockXray.emitAsync('scan:start', {
                path: '/test',
                config: { path: '/test' }
            });

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should maintain plugin state across events', async () => {
            let callCount = 0;

            const plugin: XrayPlugin = {
                name: 'stateful-plugin',
                apply: (xray) => {
                    xray.on('progress', () => {
                        callCount++;
                    });
                }
            };

            await manager.register(plugin, mockXray);

            await mockXray.emitAsync('progress', {
                stage: 'test',
                current: 1,
                total: 10,
                message: 'Testing'
            });

            await mockXray.emitAsync('progress', {
                stage: 'test',
                current: 2,
                total: 10,
                message: 'Testing'
            });

            expect(callCount).toBe(2);
        });

        it('should handle plugin errors gracefully', async () => {
            const plugin: XrayPlugin = {
                name: 'error-plugin',
                apply: () => {
                    throw new Error('Plugin initialization failed');
                }
            };

            await expect(manager.register(plugin, mockXray))
                .rejects.toThrow('Plugin initialization failed');

            expect(manager.has('error-plugin')).toBe(false);
        });

        it('should handle dispose errors gracefully', async () => {
            const plugin: XrayPlugin = {
                name: 'error-dispose',
                apply: jest.fn(),
                dispose: () => {
                    throw new Error('Dispose failed');
                }
            };

            await manager.register(plugin, mockXray);

            await expect(manager.unregister('error-dispose'))
                .rejects.toThrow('Dispose failed');
        });
    });

    describe('plugin metadata', () => {
        it('should preserve plugin version information', async () => {
            const plugin: XrayPlugin = {
                name: 'versioned-plugin',
                version: '3.2.1',
                apply: jest.fn()
            };

            await manager.register(plugin, mockXray);

            const plugins = manager.list();
            const registered = plugins.find(p => p.name === 'versioned-plugin');

            expect(registered?.version).toBe('3.2.1');
        });

        it('should work with plugins without version', async () => {
            const plugin: XrayPlugin = {
                name: 'no-version',
                apply: jest.fn()
            };

            await manager.register(plugin, mockXray);

            const plugins = manager.list();
            const registered = plugins.find(p => p.name === 'no-version');

            expect(registered?.version).toBeUndefined();
        });
    });

    describe('applyIfAbsent idempotency', () => {
        it('registers the plugin on first call and skips (without throwing) on second', async () => {
            const applyFn = jest.fn();
            const plugin: XrayPlugin = {
                name: 'idempotent-plugin',
                apply: applyFn
            };

            // Static import: jest.config resetModules gives a fresh Logger to
            // any in-test require(), which PluginManager would not share.
            const warnSpy = jest
                .spyOn(Logger, 'warn')
                .mockImplementation(() => {});

            try {
                await manager.applyIfAbsent(plugin, mockXray);
                expect(manager.has('idempotent-plugin')).toBe(true);
                expect(applyFn).toHaveBeenCalledTimes(1);

                // Second call resolves without throwing and does not re-apply.
                await expect(
                    manager.applyIfAbsent(plugin, mockXray)
                ).resolves.toBeUndefined();
                expect(applyFn).toHaveBeenCalledTimes(1);
                expect(warnSpy).toHaveBeenCalledWith(
                    expect.stringContaining('idempotent-plugin')
                );
            } finally {
                warnSpy.mockRestore();
            }
        });
    });
});
