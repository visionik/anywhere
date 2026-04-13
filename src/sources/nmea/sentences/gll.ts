import type { ParsedSentence } from '../nmea-parser.js';
import { parseNmeaCoord } from '../nmea-parser.js';

/**
 * Parse a GLL (Geographic Position — Latitude/Longitude) sentence.
 * Fields: $xxGLL,lat,N/S,lon,E/W,time,status[,mode]*xx
 */
export function parseGll(fields: string[]): ParsedSentence | null {
  if (fields.length < 6) return null;

  /* c8 ignore next */
  const status = fields[6] ?? fields[5] ?? 'A'; // some receivers omit status
  if (status === 'V') return null;
  /* c8 ignore next 2 */
  const latitude = parseNmeaCoord(fields[1] ?? '', fields[2] ?? '');
  const longitude = parseNmeaCoord(fields[3] ?? '', fields[4] ?? '');

  if (isNaN(latitude) || isNaN(longitude)) return null;

  return {
    partial: { latitude, longitude },
    triggerEmit: false,
  };
}
