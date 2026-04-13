import type { ParsedSentence } from '../nmea-parser.js';
import { parseNmeaCoord, parseNmeaTime } from '../nmea-parser.js';

const FIX_QUALITY_MAP: Record<number, string> = {
  0: 'none',
  1: '3d',
  2: 'dgps',
  4: 'rtk',
  5: '3d', // float RTK
  6: '2d', // estimated / dead-reckoning
};

/**
 * Parse a GGA (Global Positioning System Fix Data) sentence.
 * Fields: $xxGGA,time,lat,N/S,lon,E/W,quality,sats,hdop,alt,M,...*xx
 */
export function parseGga(fields: string[]): ParsedSentence | null {
  if (fields.length < 10) return null;

  /* c8 ignore next 9 */
  const timeStr = fields[1] ?? '';
  const latRaw = fields[2] ?? '';
  const latDir = fields[3] ?? '';
  const lonRaw = fields[4] ?? '';
  const lonDir = fields[5] ?? '';
  const quality = parseInt(fields[6] ?? '0', 10);
  const sats = fields[7] ? parseInt(fields[7], 10) : undefined;
  const hdop = fields[8] ? parseFloat(fields[8]) : undefined;
  const altRaw = fields[9] ?? '';

  const latitude = parseNmeaCoord(latRaw, latDir);
  const longitude = parseNmeaCoord(lonRaw, lonDir);
  const altitude = altRaw ? parseFloat(altRaw) : undefined;
  const timestamp = timeStr ? parseNmeaTime(timeStr) : undefined;
  const fixType = FIX_QUALITY_MAP[quality] ?? '3d';

  return {
    partial: {
      latitude: isNaN(latitude) ? undefined : latitude,
      longitude: isNaN(longitude) ? undefined : longitude,
      altitude,
      satellites: isNaN(sats ?? NaN) ? undefined : sats,
      hdop: isNaN(hdop ?? NaN) ? undefined : hdop,
      timestamp,
      fixType,
    },
    triggerEmit: false,
  };
}
