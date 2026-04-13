import type { Position } from './types/position.js';
import type { StatusEvent } from './types/status-event.js';

/**
 * Abstract base class for all location data providers.
 *
 * Subclass this to implement a new location source. Implement `start()` and
 * `stop()`, then call the protected `emitPosition`, `emitStatus`, and
 * `emitError` helpers when data is available.
 *
 * @example
 * ```ts
 * class MyGpsSource extends LocationSource {
 *   readonly sourceId = 'my-gps';
 *   start(): void { // begin receiving data }
 *   stop(): void  { // stop and release resources }
 * }
 * ```
 */
export abstract class LocationSource {
  /**
   * Unique identifier for this source type.
   * Used by {@link LocationManager} for priority ordering.
   * Well-known values: `'device'`, `'nmea'`, `'gdl90'`, `'simulator'`.
   */
  abstract readonly sourceId: string;

  /** Called by {@link LocationManager} when a new position fix is available. */
  onPosition?: (position: Position) => void;

  /** Called by {@link LocationManager} when the source encounters an error. */
  onError?: (error: Error) => void;

  /** Called by {@link LocationManager} when connection or fix quality changes. */
  onStatus?: (status: StatusEvent) => void;

  /** Start receiving position data. Called by {@link LocationManager#start}. */
  abstract start(): void;

  /** Stop receiving position data and release all resources. */
  abstract stop(): void;

  /**
   * Emit a normalized position fix to the registered consumer.
   * Call this from subclass implementations when a new fix is available.
   */
  protected emitPosition(position: Position): void {
    this.onPosition?.(position);
  }

  /**
   * Emit a status update to signal connection health or fix quality changes.
   */
  protected emitStatus(status: StatusEvent): void {
    this.onStatus?.(status);
  }

  /**
   * Emit an error to the registered consumer.
   */
  protected emitError(error: Error): void {
    this.onError?.(error);
  }
}
