/** Map of event names to their payload tuple types. */
export type EventMap = Record<string, unknown[]>;

/**
 * Minimal typed event emitter — cross-platform, zero runtime dependencies.
 * Provides `on`, `off`, and `emit` with full TypeScript inference on both
 * event names and their payload types.
 *
 * @example
 * ```ts
 * type Events = { position: [Position]; offline: [] };
 * const emitter = new TypedEmitter<Events>();
 * emitter.on('position', (pos) => console.log(pos.latitude));
 * emitter.emit('offline');
 * ```
 */
export class TypedEmitter<T extends EventMap> {
  private readonly _listeners: Partial<{
    [K in keyof T]: Array<(...args: T[K]) => void>;
  }> = {};

  /**
   * Register a listener for the given event.
   * @returns `this` for chaining.
   */
  on<K extends keyof T>(event: K, listener: (...args: T[K]) => void): this {
    const arr = this._listeners[event];
    if (arr) {
      arr.push(listener);
    } else {
      this._listeners[event] = [listener];
    }
    return this;
  }

  /**
   * Remove a previously registered listener.
   * No-op if the listener was not registered.
   * @returns `this` for chaining.
   */
  off<K extends keyof T>(event: K, listener: (...args: T[K]) => void): this {
    const arr = this._listeners[event];
    if (arr) {
      const idx = arr.indexOf(listener);
      if (idx !== -1) arr.splice(idx, 1);
    }
    return this;
  }

  /**
   * Emit an event, invoking all registered listeners with the provided arguments.
   */
  emit<K extends keyof T>(event: K, ...args: T[K]): void {
    const arr = this._listeners[event];
    if (arr) {
      for (const fn of [...arr]) fn(...args);
    }
  }
}
