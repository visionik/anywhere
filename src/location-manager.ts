import { TypedEmitter } from './emitter/typed-emitter.js';
import type { LocationSource } from './location-source.js';
import type { Position } from './types/position.js';
import type { StatusEvent } from './types/status-event.js';

/** Events emitted by {@link LocationManager}. */
export type LocationManagerEvents = {
  /** Emitted when a new best-available position fix is ready. */
  position: [Position];
  /**
   * Emitted when the active source changes.
   * @param from - The previous active source ID, or `null` if there was none.
   * @param to - The new active source ID, or `null` if all sources went offline.
   */
  sourceChange: [from: string | null, to: string | null];
  /** Emitted when all sources are offline (no valid fix available). */
  offline: [];
};

/** Configuration options for {@link LocationManager}. */
export interface LocationManagerOptions {
  /** Initial set of sources to register. Additional sources may be added with {@link LocationManager#addSource}. */
  sources?: LocationSource[];
  /**
   * Source IDs in descending priority order (highest priority first).
   * Sources not in this list are treated as lowest priority.
   */
  priorityOrder?: string[];
  /** Minimum milliseconds between emitted `position` events. Default: `0` (no throttle). */
  minUpdateIntervalMs?: number;
  /**
   * Milliseconds a higher-priority source must remain healthy before being promoted.
   * Prevents rapid oscillation between sources. Default: `2000`.
   */
  hysteresisMs?: number;
  /**
   * Minimum quality score (0–1) required to consider a source valid.
   * Default: `0` (accept any quality).
   */
  minQuality?: number;
  /**
   * What to do when all sources lose their fix:
   * - `'event'` — emit `offline` event only (default)
   * - `'stale'` — emit last known position with `stale: true`, then emit `offline`
   * - `'retry'` — emit `offline`, then restart all sources after `retryIntervalMs`
   */
  offlineBehavior?: 'event' | 'stale' | 'retry';
  /** Milliseconds between restart attempts when `offlineBehavior` is `'retry'`. Default: `5000`. */
  retryIntervalMs?: number;
  /** Reserved for future sensor fusion (no-op in v0.1). */
  fusionStrategy?: undefined;
}

interface SourceState {
  source: LocationSource;
  healthy: boolean;
  quality: number;
  lastPosition: Position | null;
  /** `true` once at least one `StatusEvent` has been received from this source. */
  hasReceivedStatus: boolean;
}

/**
 * Central orchestrator for multiple location sources.
 *
 * Manages source lifecycle, priority-based source selection, automatic
 * fallback, hysteresis-gated promotion, and configurable offline behavior.
 *
 * @example
 * ```ts
 * const manager = new LocationManager({
 *   sources: [new GDL90Source({ port: 4000 }), new NMEASource({ type: 'udp', port: 10110 })],
 *   priorityOrder: ['gdl90', 'nmea'],
 *   offlineBehavior: 'stale',
 * });
 * manager.on('position', (pos) => console.log(pos.latitude, pos.longitude));
 * manager.start();
 * ```
 */
export class LocationManager extends TypedEmitter<LocationManagerEvents> {
  private readonly _sources = new Map<string, SourceState>();
  private readonly _opts: Required<Omit<LocationManagerOptions, 'sources' | 'fusionStrategy'>>;
  private _activeId: string | null = null;
  private _lastEmitTime = 0;
  private _lastPosition: Position | null = null;
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _hysteresisTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: LocationManagerOptions = {}) {
    super();
    this._opts = {
      priorityOrder: options.priorityOrder ?? [],
      minUpdateIntervalMs: options.minUpdateIntervalMs ?? 0,
      hysteresisMs: options.hysteresisMs ?? 2000,
      minQuality: options.minQuality ?? 0,
      offlineBehavior: options.offlineBehavior ?? 'event',
      retryIntervalMs: options.retryIntervalMs ?? 5000,
    };
    for (const source of options.sources ?? []) {
      this.addSource(source);
    }
  }

  /**
   * Register a location source. Sources may be added before or after `start()`.
   * @returns `this` for chaining.
   */
  addSource(source: LocationSource): this {
    const id = source.sourceId;
    source.onPosition = (pos: Position) => {
      this._handlePosition(id, pos);
    };
    source.onStatus = (status: StatusEvent) => {
      this._handleStatus(id, status);
    };
    source.onError = (_err: Error) => {
      this._markUnhealthy(id);
    };
    this._sources.set(id, { source, healthy: false, quality: 0, lastPosition: null, hasReceivedStatus: false });
    return this;
  }

  /**
   * Remove a source by ID, stopping it if running.
   * @returns `this` for chaining.
   */
  removeSource(sourceId: string): this {
    const state = this._sources.get(sourceId);
    if (state) {
      state.source.stop();
      this._sources.delete(sourceId);
      const pending = this._hysteresisTimers.get(sourceId);
      if (pending !== undefined) {
        clearTimeout(pending);
        this._hysteresisTimers.delete(sourceId);
      }
      if (this._activeId === sourceId) {
        this._activeId = null;
        this._reevaluate();
      }
    }
    return this;
  }

  /** Start all registered sources. */
  start(): void {
    for (const { source } of this._sources.values()) source.start();
  }

  /** Stop all registered sources and cancel pending timers. */
  stop(): void {
    for (const { source } of this._sources.values()) source.stop();
    if (this._retryTimer !== null) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    for (const timer of this._hysteresisTimers.values()) clearTimeout(timer);
    this._hysteresisTimers.clear();
  }

  // ─── Internal handlers ──────────────────────────────────────────────────────

  private _handlePosition(id: string, pos: Position): void {
    const state = this._sources.get(id);
    if (!state) return;
    state.lastPosition = pos;
    state.healthy = true;
    // Only derive quality from the position if no explicit status has been received.
    // Once a source has emitted a StatusEvent, quality is managed exclusively by those events.
    if (!state.hasReceivedStatus) state.quality = this._deriveQuality(pos);
    this._reevaluate(id, pos);
  }

  private _handleStatus(id: string, status: StatusEvent): void {
    const state = this._sources.get(id);
    if (!state) return;
    state.hasReceivedStatus = true;
    state.healthy = status.connected;
    state.quality = status.quality;
    this._reevaluate();
  }

  private _markUnhealthy(id: string): void {
    const state = this._sources.get(id);
    if (!state) return;
    state.healthy = false;
    this._reevaluate();
  }

  private _reevaluate(triggeredId?: string, triggeredPos?: Position): void {
    const bestId = this._getBestId();

    if (!bestId) {
      // No healthy sources — go offline if we had an active source
      if (this._activeId !== null) {
        const prev = this._activeId;
        this._activeId = null;
        this.emit('sourceChange', prev, null);
        this._handleOffline();
      }
      return;
    }

    if (bestId === this._activeId) {
      if (triggeredId === this._activeId && triggeredPos) this._maybeEmit(triggeredPos);
      return;
    }

    if (this._activeId === null) {
      // Nothing active yet — promote immediately
      this._promote(bestId, null);
      if (triggeredId === bestId && triggeredPos) this._maybeEmit(triggeredPos);
      return;
    }

    const currState = this._sources.get(this._activeId);
    const currHealthy = currState?.healthy ?? false;

    if (!currHealthy) {
      // Active source is dead — switch to best immediately, preserving the from-ID
      const prev = this._activeId;
      this._promote(bestId, prev);
      if (triggeredId === bestId && triggeredPos) this._maybeEmit(triggeredPos);
      return;
    }

    // Active source is still healthy; compare priority
    const currPriority = this._getPriority(this._activeId);
    const bestPriority = this._getPriority(bestId);

    if (bestPriority < currPriority) {
      // A higher-priority source wants to take over — apply hysteresis
      if (!this._hysteresisTimers.has(bestId)) {
        const timer = setTimeout(() => {
          this._hysteresisTimers.delete(bestId);
          const currentBest = this._getBestId();
          if (currentBest === bestId && this._activeId !== bestId) {
            const prev = this._activeId;
            this._promote(bestId, prev);
            const s = this._sources.get(bestId);
            if (s?.lastPosition) this._maybeEmit(s.lastPosition);
          }
        }, this._opts.hysteresisMs);
        this._hysteresisTimers.set(bestId, timer);
      }
      // Keep emitting from current active while hysteresis is pending
      if (triggeredId === this._activeId && triggeredPos) this._maybeEmit(triggeredPos);
    } else {
      // bestId has equal or lower priority than current — keep current active
      if (triggeredId === this._activeId && triggeredPos) this._maybeEmit(triggeredPos);
    }
  }

  private _promote(newId: string, prevId: string | null): void {
    this._activeId = newId;
    this.emit('sourceChange', prevId, newId);
    const pending = this._hysteresisTimers.get(newId);
    if (pending !== undefined) {
      clearTimeout(pending);
      this._hysteresisTimers.delete(newId);
    }
  }

  private _getBestId(): string | null {
    let bestId: string | null = null;
    let bestPriority = Infinity;
    for (const [id, state] of this._sources) {
      if (!state.healthy || state.quality < this._opts.minQuality) continue;
      const p = this._getPriority(id);
      if (p < bestPriority) {
        bestPriority = p;
        bestId = id;
      }
    }
    return bestId;
  }

  private _getPriority(id: string): number {
    const idx = this._opts.priorityOrder.indexOf(id);
    return idx === -1 ? this._opts.priorityOrder.length : idx;
  }

  private _maybeEmit(pos: Position): void {
    const now = Date.now();
    if (now - this._lastEmitTime < this._opts.minUpdateIntervalMs) return;
    this._lastEmitTime = now;
    this._lastPosition = pos;
    this.emit('position', pos);
  }

  private _handleOffline(): void {
    const behavior = this._opts.offlineBehavior;
    if (behavior === 'stale' && this._lastPosition !== null) {
      this.emit('position', { ...this._lastPosition, stale: true });
    }
    this.emit('offline');
    if (behavior === 'retry') {
      this._scheduleRetry();
    }
  }

  private _scheduleRetry(): void {
    if (this._retryTimer !== null) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      for (const { source } of this._sources.values()) {
        source.stop();
        source.start();
      }
      if (this._getBestId() === null) this._scheduleRetry();
    }, this._opts.retryIntervalMs);
  }

  /** Derive a 0–1 quality score from available position metadata. */
  private _deriveQuality(pos: Position): number {
    if (pos.hdop !== undefined) {
      // HDOP: 1 = ideal, 2 = excellent, 5 = moderate, 10 = poor, >10 = very poor
      return Math.max(0, Math.min(1, 1 - (pos.hdop - 1) / 9));
    }
    if (pos.accuracy !== undefined) {
      // accuracy in meters: ≤5 → 1.0, 50 → ~0.5, ≥100 → 0.0
      return Math.max(0, Math.min(1, 1 - (pos.accuracy - 5) / 95));
    }
    return 1;
  }
}
