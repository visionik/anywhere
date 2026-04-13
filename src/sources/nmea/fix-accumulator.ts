import type { Position } from '../../types/position.js';
import type { ParsedSentence } from './nmea-parser.js';

/**
 * Accumulates partial `Position` fields from multiple NMEA sentences
 * and emits a complete `Position` when an epoch-ending sentence arrives
 * (currently: valid RMC).
 *
 * The typical NMEA sentence order per cycle is GGA → GLL → GSA → VTG → RMC,
 * so altitude, satellites, and HDOP from GGA are already in the accumulator
 * when RMC triggers the emission.
 */
export class FixAccumulator {
  private _acc: Partial<Position> = {};

  /**
   * Add a parsed sentence to the accumulator.
   * @returns A complete `Position` if the sentence triggers an epoch end, otherwise `null`.
   */
  add(sentence: ParsedSentence): Position | null {
    // Merge non-undefined fields from this sentence into the accumulator
    for (const [key, val] of Object.entries(sentence.partial)) {
      if (val !== undefined) {
        (this._acc as Record<string, unknown>)[key] = val;
      }
    }

    if (!sentence.triggerEmit) return null;

    const { latitude, longitude, timestamp } = this._acc;
    if (latitude === undefined || longitude === undefined || timestamp === undefined) return null;

    const pos: Position = {
      latitude,
      longitude,
      altitude: this._acc.altitude,
      speed: this._acc.speed,
      heading: this._acc.heading,
      timestamp,
      accuracy: this._acc.accuracy,
      verticalAccuracy: this._acc.verticalAccuracy,
      satellites: this._acc.satellites,
      hdop: this._acc.hdop,
      fixType: this._acc.fixType,
      source: 'nmea',
    };

    this._acc = {};
    return pos;
  }

  /** Reset all accumulated state. */
  reset(): void {
    this._acc = {};
  }
}
