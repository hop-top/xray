import { AsyncEventEmitter } from '../../src/lib/events/async-emitter';

interface TestEvents {
    'test:simple': { value: number };
    'test:mutable': { items: string[] };
    'test:error': { shouldFail: boolean };
    'error': { event: string; error: Error; payload: any };
}

describe('AsyncEventEmitter', () => {
    let emitter: AsyncEventEmitter<TestEvents>;

    beforeEach(() => {
        emitter = new AsyncEventEmitter<TestEvents>();
    });

    describe('emitAsync (sequential execution)', () => {
        it('should execute listeners sequentially in registration order', async () => {
            const executionOrder: number[] = [];

            emitter.on('test:simple', async (payload) => {
                await new Promise(resolve => setTimeout(resolve, 10));
                executionOrder.push(1);
            });

            emitter.on('test:simple', async (payload) => {
                await new Promise(resolve => setTimeout(resolve, 5));
                executionOrder.push(2);
            });

            emitter.on('test:simple', async (payload) => {
                executionOrder.push(3);
            });

            await emitter.emitAsync('test:simple', { value: 42 });

            expect(executionOrder).toEqual([1, 2, 3]);
        });

        it('should allow listeners to modify mutable payloads sequentially', async () => {
            const payload = { items: ['a'] };

            emitter.on('test:mutable', async (event) => {
                event.items.push('b');
            });

            emitter.on('test:mutable', async (event) => {
                // This listener sees modifications from first listener
                event.items.push('c');
            });

            emitter.on('test:mutable', async (event) => {
                // This listener sees all previous modifications
                expect(event.items).toEqual(['a', 'b', 'c']);
                event.items.push('d');
            });

            await emitter.emitAsync('test:mutable', payload);

            expect(payload.items).toEqual(['a', 'b', 'c', 'd']);
        });

        it('should isolate errors from individual listeners', async () => {
            const results: string[] = [];

            emitter.on('test:error', async (payload) => {
                results.push('listener1');
            });

            emitter.on('test:error', async (payload) => {
                throw new Error('Listener 2 failed');
            });

            emitter.on('test:error', async (payload) => {
                results.push('listener3');
            });

            // Set up error event listener
            const errors: Error[] = [];
            emitter.on('error', (errorEvent) => {
                errors.push(errorEvent.error);
            });

            await emitter.emitAsync('test:error', { shouldFail: false });

            expect(results).toEqual(['listener1', 'listener3']);
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toBe('Listener 2 failed');
        });

        it('should handle async errors without breaking the pipeline', async () => {
            const results: number[] = [];

            emitter.on('test:simple', async () => {
                results.push(1);
            });

            emitter.on('test:simple', async () => {
                throw new Error('Async error');
            });

            emitter.on('test:simple', async () => {
                results.push(3);
            });

            const errorHandler = jest.fn();
            emitter.on('error', errorHandler);

            await emitter.emitAsync('test:simple', { value: 1 });

            expect(results).toEqual([1, 3]);
            expect(errorHandler).toHaveBeenCalledTimes(1);
        });
    });

    describe('emitAsyncParallel (parallel execution)', () => {
        it('should execute all listeners in parallel', async () => {
            const startTime = Date.now();
            const executionTimes: number[] = [];

            emitter.on('test:simple', async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                executionTimes.push(Date.now());
            });

            emitter.on('test:simple', async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                executionTimes.push(Date.now());
            });

            emitter.on('test:simple', async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                executionTimes.push(Date.now());
            });

            await emitter.emitAsyncParallel('test:simple', { value: 42 });

            const totalTime = Date.now() - startTime;

            // If parallel, should take ~50ms, not ~150ms
            expect(totalTime).toBeLessThan(100);
            expect(executionTimes).toHaveLength(3);
        });

        it('should handle errors without affecting other listeners', async () => {
            const results: string[] = [];

            emitter.on('test:error', async () => {
                results.push('listener1');
            });

            emitter.on('test:error', async () => {
                throw new Error('Parallel listener failed');
            });

            emitter.on('test:error', async () => {
                results.push('listener3');
            });

            const errorHandler = jest.fn();
            emitter.on('error', errorHandler);

            await emitter.emitAsyncParallel('test:error', { shouldFail: false });

            expect(results).toContain('listener1');
            expect(results).toContain('listener3');
            expect(errorHandler).toHaveBeenCalledTimes(1);
        });

        it('should collect all errors from failed listeners', async () => {
            emitter.on('test:error', async () => {
                throw new Error('Error 1');
            });

            emitter.on('test:error', async () => {
                throw new Error('Error 2');
            });

            emitter.on('test:error', async () => {
                throw new Error('Error 3');
            });

            const errors: Error[] = [];
            emitter.on('error', (errorEvent) => {
                errors.push(errorEvent.error);
            });

            await emitter.emitAsyncParallel('test:error', { shouldFail: true });

            expect(errors).toHaveLength(3);
            expect(errors.map(e => e.message)).toEqual(['Error 1', 'Error 2', 'Error 3']);
        });
    });

    describe('error recursion protection', () => {
        it('should prevent infinite recursion from error event listeners', async () => {
            let errorDepth = 0;
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            emitter.on('error', () => {
                errorDepth++;
                if (errorDepth > 3) return;
                throw new Error('Error in error handler');
            });

            emitter.on('test:simple', async () => {
                throw new Error('Initial error');
            });

            // Should complete without infinite loop
            await emitter.emitAsync('test:simple', { value: 1 });

            // Should have attempted error handling but stopped at max depth
            expect(errorDepth).toBeGreaterThan(0);
            expect(errorDepth).toBeLessThanOrEqual(4);

            consoleErrorSpy.mockRestore();
        });

        it('should not re-emit error events from error handlers', async () => {
            const errorLogs: string[] = [];
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
                errorLogs.push(args.join(' '));
            });

            emitter.on('error', async () => {
                throw new Error('Error handler failed');
            });

            emitter.on('test:simple', async () => {
                throw new Error('Original error');
            });

            await emitter.emitAsync('test:simple', { value: 1 });

            // Should log "Error in error handler (not re-emitting)" for error event errors
            expect(errorLogs.some(log => log.includes('Error in error handler'))).toBe(true);

            consoleErrorSpy.mockRestore();
        });
    });

    describe('type-safe listener registration', () => {
        it('should support on() for adding listeners', () => {
            const listener = jest.fn();
            const result = emitter.on('test:simple', listener);

            expect(result).toBe(emitter); // Should return this for chaining
            expect(emitter.listenerCount('test:simple')).toBe(1);
        });

        it('should support once() for one-time listeners', async () => {
            const listener = jest.fn();
            emitter.once('test:simple', listener);

            await emitter.emitAsync('test:simple', { value: 1 });
            await emitter.emitAsync('test:simple', { value: 2 });

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith({ value: 1 });
        });

        it('should support off() for removing listeners', async () => {
            const listener = jest.fn();
            emitter.on('test:simple', listener);
            emitter.off('test:simple', listener);

            await emitter.emitAsync('test:simple', { value: 1 });

            expect(listener).not.toHaveBeenCalled();
        });

        it('should support multiple listeners for the same event', async () => {
            const listener1 = jest.fn();
            const listener2 = jest.fn();
            const listener3 = jest.fn();

            emitter.on('test:simple', listener1);
            emitter.on('test:simple', listener2);
            emitter.on('test:simple', listener3);

            await emitter.emitAsync('test:simple', { value: 1 });

            expect(listener1).toHaveBeenCalled();
            expect(listener2).toHaveBeenCalled();
            expect(listener3).toHaveBeenCalled();
        });
    });

    describe('backward compatibility with EventEmitter', () => {
        it('should still support synchronous emit()', () => {
            const listener = jest.fn();
            emitter.on('test:simple', listener);

            emitter.emit('test:simple', { value: 42 });

            expect(listener).toHaveBeenCalledWith({ value: 42 });
        });

        it('should have all EventEmitter methods available', () => {
            expect(typeof emitter.listeners).toBe('function');
            expect(typeof emitter.listenerCount).toBe('function');
            expect(typeof emitter.removeAllListeners).toBe('function');
            expect(typeof emitter.setMaxListeners).toBe('function');
        });
    });
});
