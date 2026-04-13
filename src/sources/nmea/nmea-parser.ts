import type { Position } from '../../types/position.js';
import { parseRmc } from './sentences/rmc.js';
import { parseGga } from './sentences/gga.js';
import { parseVtg } from './sentences/vtg.js';
import { parseGsa } from './sentences/gsa.js';
import { parseGll } from './sentences/gll.js';

/** A parsed NMEA sentence result ready for the {@link FixAccumulator}. */
export interface ParsedSentence {
  /** Partial position fields extracted from this sentence. */
  partial: Partial<Position>;
  /**
   * When `true`, this sentence ends an epoch and the accumulator
   * should emit a complete position (currently only valid RMC sentences).
   */
  triggerEmit: boolean;
}

// ─── Checksum ────────────────────────────────────────────────────────────────

/**
 * Validate the NMEA XOR checksum at the end of a sentence (`*XX`).
 * Returns `false` if no checksum marker is present.
 */
export function validateChecksum(sentence: string): boolean {
  const starIdx = sentence.lastIndexOf('*');
  if (starIdx === -1) return false;
  const content = sentence.startsWith('$') ? sentence.slice(1, starIdx) : sentence.slice(0, starIdx);
  const expected = parseInt(sentence.slice(starIdx + 1), 16);
  if (isNaN(expected)) return false;
  let xor = 0;
  for (let i = 0; i < content.length; i++) xor ^= content.charCodeAt(i);
  return xor === expected;
}

// ─── Coordinate helper ────────────────────────────────────────────────────────

/**
 * Parse an NMEA coordinate string (DDMM.MMMM or DDDMM.MMMM) and
 * apply a cardinal direction indicator (N/S/E/W) to produce decimal degrees.
 */
export function parseNmeaCoord(raw: string, direction: string): number {
  if (!raw) return NaN;
  const dotIdx = raw.indexOf('.');
  if (dotIdx < 2) return NaN;
  const minuteStart = dotIdx - 2;
  const degrees = parseInt(raw.slice(0, minuteStart), 10);
  const minutes = parseFloat(raw.slice(minuteStart));
  const decimal = degrees + minutes / 60;
  return direction === 'S' || direction === 'W' ? -decimal : decimal;
}

// ─── UTC time parsing ─────────────────────────────────────────────────────────

/**
 * Construct a UTC `Date` from NMEA time (HHMMSS.ss) and date (DDMMYY) strings.
 * If date is absent, uses today's UTC date as a fallback.
 */
export function parseNmeaTime(timeStr: string, dateStr?: string): Date {
  const h = parseInt(timeStr.slice(0, 2), 10);
  const m = parseInt(timeStr.slice(2, 4), 10);
  const s = parseFloat(timeStr.slice(4));
  const ms = Math.round((s % 1) * 1000);
  const sec = Math.floor(s);

  if (dateStr && dateStr.length >= 6) {
    const day = parseInt(dateStr.slice(0, 2), 10);
    const month = parseInt(dateStr.slice(2, 4), 10) - 1;
    const year = 2000 + parseInt(dateStr.slice(4, 6), 10);
    return new Date(Date.UTC(year, month, day, h, m, sec, ms));
  }

  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, sec, ms));
}

// ─── Sentence dispatch ────────────────────────────────────────────────────────

/**
 * Parse a complete NMEA sentence string into a {@link ParsedSentence}.
 *
 * Returns `null` if the sentence has an invalid checksum, unknown type, or
 * insufficient fields. Handles all standard talker-ID prefixes (GP, GN, GL, GA).
 */
export function parseSentence(sentence: string): ParsedSentence | null {
  if (!validateChecksum(sentence)) return null;

  // Strip checksum suffix
  const starIdx = sentence.lastIndexOf('*');
  const raw = starIdx !== -1 ? sentence.slice(0, starIdx) : sentence;
  const fields = raw.split(',');
  if (fields.length < 2) return null;

  // Extract sentence type, stripping talker prefix ($GPRMC → RMC, $GNRMC → RMC)
  const id = fields[0]!.slice(1); // strip '$'
  const type = id.length >= 5 ? id.slice(2) : id; // strip 2-char talker ID

  switch (type) {
    case 'RMC': return parseRmc(fields);
    case 'GGA': return parseGga(fields);
    case 'VTG': return parseVtg(fields);
    case 'GSA': return parseGsa(fields);
    case 'GLL': return parseGll(fields);
    default:    return null;
  }
}
