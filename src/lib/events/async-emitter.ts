import { EventEmitter } from 'events';
import { Logger } from '../logger';

export class AsyncEventEmitter<Events extends Record<string, any>> extends EventEmitter {
  private errorDepth: number = 0;
  private readonly MAX_ERROR_DEPTH = 3;

  /**
   * Emit event and wait for all async listeners to complete sequentially
   * Use for transformation pipelines where listener order matters
   */
  async emitAsync<K extends keyof Events>(
    event: K,
    payload: Events[K]
  ): Promise<void> {
    // Get raw listeners to properly handle once() wrappers
    const rawListeners = this.rawListeners(event as string);

    for (const listener of rawListeners) {
      try {
        const result = listener(payload);
        if (result && typeof result.then === 'function') {
          await result;
        }
      } catch (error) {
        await this.handleListenerError(event, error, payload);
      }
    }
  }

  /**
   * Emit event and wait for all async listeners to complete in parallel
   * Use for independent observers (logging, metrics, monitoring)
   * Much faster than sequential when listeners don't depend on each other
   */
  async emitAsyncParallel<K extends keyof Events>(
    event: K,
    payload: Events[K]
  ): Promise<void> {
    // Get raw listeners to properly handle once() wrappers
    const rawListeners = this.rawListeners(event as string);

    const results = await Promise.allSettled(
      rawListeners.map(listener => {
        const result = listener(payload);
        // Ensure we return a promise
        return result && typeof result.then === 'function' ? result : Promise.resolve(result);
      })
    );

    // Handle errors from failed listeners
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        await this.handleListenerError(
          event,
          (results[i] as PromiseRejectedResult).reason,
          payload
        );
      }
    }
  }

  /**
   * Handle listener errors with recursion protection
   */
  private async handleListenerError(
    event: any,
    error: any,
    payload: any
  ): Promise<void> {
    // Prevent error event recursion
    if (event === 'error') {
      Logger.error('Error in error handler (not re-emitting)', error);
      return;
    }

    // Track recursion depth
    this.errorDepth++;
    if (this.errorDepth > this.MAX_ERROR_DEPTH) {
      Logger.error('Max error depth reached', error);
      this.errorDepth--;
      throw error;
    }

    try {
      // Use sync emit for error events to avoid recursion
      // We need to manually iterate and catch errors to prevent process crashes
      const errorListeners = this.listeners('error');
      for (const listener of errorListeners) {
        try {
          const result = listener({
            event,
            error: error as Error,
            payload
          });
          // If listener returns a promise, handle it but don't await
          if (result && typeof result.catch === 'function') {
            result.catch((err: any) => {
              Logger.error('Error in error handler (not re-emitting)', err);
            });
          }
        } catch (syncError) {
          Logger.error('Error in error handler (not re-emitting)', syncError);
        }
      }
    } finally {
      this.errorDepth--;
    }
  }

  /**
   * Type-safe event listener registration
   * Overload to support both our typed events and base EventEmitter
   */
  on<K extends keyof Events>(
    event: K | string | symbol,
    listener: (payload: Events[K]) => void | Promise<void>
  ): this {
    return super.on(event as string | symbol, listener as any);
  }

  /**
   * Type-safe one-time listener
   * Overload to support both our typed events and base EventEmitter
   */
  once<K extends keyof Events>(
    event: K | string | symbol,
    listener: (payload: Events[K]) => void | Promise<void>
  ): this {
    return super.once(event as string | symbol, listener as any);
  }

  /**
   * Remove specific listener
   * Overload to support both our typed events and base EventEmitter
   */
  off<K extends keyof Events>(
    event: K | string | symbol,
    listener: (payload: Events[K]) => void | Promise<void>
  ): this {
    return super.off(event as string | symbol, listener as any);
  }
}
