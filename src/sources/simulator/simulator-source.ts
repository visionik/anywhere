import { LocationSource } from '../../location-source.js';
import type { Position } from '../../types/position.js';

/** Options for {@link SimulatorSource}. */
export interface SimulatorSourceOptions {
  /** Array of positions to replay in order. */
  route: Position[];
  /** Milliseconds between each emitted position. */
  intervalMs: number;
  /**
   * When `true` (default), replay loops back to `route[0]` after the last position.
   * When `false`, emission stops after the last position and `onStatus` is called
   * with `{ connected: false, quality: 0 }` to signal the source is exhausted.
   */
  loop?: boolean;
  /**
   * Override the source identifier reported to {@link LocationManager}.
   * Default: `'simulator'`. Set this when running multiple simulator sources
   * with different priorities (e.g. `'gdl90'`, `'nmea'`).
   */
  sourceId?: string;
}

/**
 * A location source that replays a pre-recorded route of `Position` objects.
 *
 * Useful for testing `LocationManager` priority and fallback logic without
 * requiring physical hardware.
 *
 * @example
 * ```ts
 * const source = new SimulatorSource({
 *   route: [{ latitude: 37.77, longitude: -122.42, timestamp: new Date(), source: 'simulator' }],
 *   intervalMs: 1000,
 *   loop: true,
 * });
 * source.onPosition = (pos) => console.log(pos);
 * source.start();
 * ```
 */
export class SimulatorSource extends LocationSource {
  override readonly sourceId: string;

  private readonly _route: Position[];
  private readonly _intervalMs: number;
  private readonly _loop: boolean;
  private _index = 0;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _statusEmitted = false;

  /**
   * @param options - Route replay configuration for the simulator.
   */
  constructor(options: SimulatorSourceOptions) {
    super();
    this.sourceId = options.sourceId ?? 'simulator';
    this._route = options.route;
    this._intervalMs = options.intervalMs;
    this._loop = options.loop ?? true;
  }

  override start(): void {
    this.stop();
    this._index = 0;
    this._statusEmitted = false;
    this._scheduleNext();
  }

  override stop(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _scheduleNext(): void {
    if (this._route.length === 0) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._emit();
    }, this._intervalMs);
  }

  private _emit(): void {
    const pos = this._route[this._index];
    /* c8 ignore next */
    if (pos === undefined) return;

    this.emitPosition({ ...pos, source: this.sourceId, timestamp: new Date() });

    if (!this._statusEmitted) {
      this._statusEmitted = true;
      this.emitStatus({ connected: true, quality: 1 });
    }

    this._index++;

    if (this._index >= this._route.length) {
      if (this._loop) {
        this._index = 0;
        this._scheduleNext();
      } else {
        // One-shot exhausted — signal offline so LocationManager can fall back
        this.emitStatus({ connected: false, quality: 0 });
      }
    } else {
      this._scheduleNext();
    }
  }
}
