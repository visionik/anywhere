/**
 * A normalized GPS/location fix emitted by any {@link LocationSource}.
 * All sources normalize their output to this common shape so consumers
 * never need format-specific handling.
 */
export interface Position {
  /** Latitude in decimal degrees (WGS84). */
  latitude: number;
  /** Longitude in decimal degrees (WGS84). */
  longitude: number;
  /** Altitude in meters above mean sea level (MSL) or geometric height. Optional. */
  altitude?: number;
  /** Ground speed in meters per second. Optional. */
  speed?: number;
  /** True heading in degrees (0–360). Optional. */
  heading?: number;
  /** UTC time of the fix. */
  timestamp: Date;
  /** Horizontal accuracy estimate in meters. Optional. */
  accuracy?: number;
  /** Vertical accuracy estimate in meters. Optional. */
  verticalAccuracy?: number;
  /**
   * Identifies which provider produced this fix.
   * Well-known values: `'device'`, `'nmea'`, `'gdl90'`, `'simulator'`.
   */
  source: 'device' | 'nmea' | 'gdl90' | 'simulator' | string;
  /** Number of satellites used in the fix. Optional. */
  satellites?: number;
  /** Horizontal dilution of precision. Lower is better. Optional. */
  hdop?: number;
  /**
   * Fix quality type. Optional.
   * Values: `'none'`, `'2d'`, `'3d'`, `'dgps'`, `'rtk'`.
   */
  fixType?: 'none' | '2d' | '3d' | 'dgps' | 'rtk' | string;
  /** Roll angle in degrees from AHRS (positive = right wing down). Optional. */
  roll?: number;
  /** Pitch angle in degrees from AHRS (positive = nose up). Optional. */
  pitch?: number;
  /** Magnetic variation in degrees (positive = east). Optional. */
  magneticVariation?: number;
  /**
   * When `true`, this position was emitted as a stale holdover because all
   * sources are currently offline (`offlineBehavior: 'stale'`).
   */
  stale?: boolean;
}
