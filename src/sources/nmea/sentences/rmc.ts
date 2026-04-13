import type { ParsedSentence } from '../nmea-parser.js';
import { parseNmeaCoord, parseNmeaTime } from '../nmea-parser.js';

/**
 * Parse an RMC (Recommended Minimum Specific GPS Data) sentence.
 * Fields: $xxRMC,time,status,lat,N/S,lon,E/W,speed,course,date,magvar,E/W[,mode]*xx
 */
export function parseRmc(fields: string[]): ParsedSentence | null {
  if (fields.length < 10) return null;

  /* c8 ignore next 9 */
  const timeStr = fields[1] ?? '';
  const status = fields[2] ?? '';
  const latRaw = fields[3] ?? '';
  const latDir = fields[4] ?? '';
  const lonRaw = fields[5] ?? '';
  const lonDir = fields[6] ?? '';
  const speedRaw = fields[7] ?? '';
  const courseRaw = fields[8] ?? '';
  const dateStr = fields[9] ?? '';

  const valid = status === 'A';
  const latitude = parseNmeaCoord(latRaw, latDir);
  const longitude = parseNmeaCoord(lonRaw, lonDir);
  const speed = speedRaw ? parseFloat(speedRaw) * 0.514444 : undefined; // knots → m/s
  const heading = courseRaw ? parseFloat(courseRaw) : undefined;
  /* c8 ignore next */
  const timestamp = timeStr ? parseNmeaTime(timeStr, dateStr) : new Date();

  return {
    partial: {
      latitude: isNaN(latitude) ? undefined : latitude,
      longitude: isNaN(longitude) ? undefined : longitude,
      speed,
      heading,
      timestamp,
      fixType: valid ? '2d' : 'none',
    },
    triggerEmit: valid && !isNaN(latitude) && !isNaN(longitude),
  };
}
