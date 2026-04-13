import { LocationSource } from '../../location-source.js';
import type { Position } from '../../types/position.js';

/** Options for {@link DeviceLocationSource}. */
export interface DeviceLocationSourceOptions {
  /**
   * Request the most accurate position available (e.g. GPS rather than IP).
   * May consume more battery. Default: `true`.
   */
  enableHighAccuracy?: boolean;
  /** Maximum milliseconds to wait for a fix before calling `onError`. Default: `10000`. */
  timeoutMs?: number;
  /** Maximum age in milliseconds of a cached fix that is still acceptable. Default: `0` (always fresh). */
  maximumAgeMs?: number;
  /**
   * Delivery mode:
   * - `'watch'` (default) — continuous stream via `watchPosition`
   * - `'once'` — single fix via `getCurrentPosition`
   */
  mode?: 'watch' | 'once';
}

/**
 * Location source backed by the W3C Geolocation API (`navigator.geolocation`).
 *
 * Works in any browser environment. On native platforms (iOS, Android, Desktop),
 * use a Capacitor/Electron bridge that maps `navigator.geolocation` to the
 * platform's native location API.
 *
 * @example
 * ```ts
 * const source = new DeviceLocationSource({ enableHighAccuracy: true });
 * source.onPosition = (pos) => console.log(pos.latitude, pos.longitude);
 * source.start();
 * ```
 */
export class DeviceLocationSource extends LocationSource {
  override readonly sourceId = 'device';

  private readonly _opts: Required<DeviceLocationSourceOptions>;
  private _watchId: number | null = null;

  constructor(options: DeviceLocationSourceOptions = {}) {
    super();
    this._opts = {
      enableHighAccuracy: options.enableHighAccuracy ?? true,
      timeoutMs: options.timeoutMs ?? 10000,
      maximumAgeMs: options.maximumAgeMs ?? 0,
      mode: options.mode ?? 'watch',
    };
  }

  override start(): void {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.emitError(new Error('navigator.geolocation is not available in this environment'));
      return;
    }

    const opts: PositionOptions = {
      enableHighAccuracy: this._opts.enableHighAccuracy,
      timeout: this._opts.timeoutMs,
      maximumAge: this._opts.maximumAgeMs,
    };

    const onSuccess = (geoPos: GeolocationPosition): void => {
      const pos = this._normalize(geoPos);
      this.emitPosition(pos);
      this.emitStatus({ connected: true, quality: this._deriveQuality(geoPos.coords.accuracy) });
    };

    const onError = (err: GeolocationPositionError): void => {
      this.emitError(new Error(`Geolocation error (code ${err.code}): ${err.message}`));
      this.emitStatus({ connected: false, quality: 0 });
    };

    if (this._opts.mode === 'watch') {
      this._watchId = navigator.geolocation.watchPosition(onSuccess, onError, opts);
    } else {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, opts);
    }
  }

  override stop(): void {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
    this.emitStatus({ connected: false, quality: 0 });
  }

  private _normalize(geoPos: GeolocationPosition): Position {
    const { coords } = geoPos;
    return {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: coords.altitude ?? undefined,
      speed: coords.speed ?? undefined,
      heading: coords.heading ?? undefined,
      timestamp: new Date(geoPos.timestamp),
      accuracy: coords.accuracy,
      verticalAccuracy: coords.altitudeAccuracy ?? undefined,
      source: 'device',
      fixType: coords.altitude !== null ? '3d' : '2d',
    };
  }

  private _deriveQuality(accuracy: number): number {
    // accuracy (meters): ≤5 → 1.0, 100 → 0.0
    return Math.max(0, Math.min(1, 1 - (accuracy - 5) / 95));
  }
}
