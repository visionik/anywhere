import type { ParsedSentence } from '../nmea-parser.js';

const FIX_TYPE_MAP: Record<number, string> = { 1: 'none', 2: '2d', 3: '3d' };

/**
 * Parse a GSA (GPS DOP and Active Satellites) sentence.
 * Fields: $xxGSA,mode,fixType,sv1..sv12,pdop,hdop,vdop*xx
 */
export function parseGsa(fields: string[]): ParsedSentence | null {
  if (fields.length < 17) return null;

  const fixTypeRaw = parseInt(fields[2] ?? '1', 10);
  const hdop = fields[16] ? parseFloat(fields[16]) : undefined;
  const fixType = FIX_TYPE_MAP[fixTypeRaw] ?? 'none';

  return {
    partial: {
      hdop: hdop !== undefined && !isNaN(hdop) ? hdop : undefined,
      fixType,
    },
    triggerEmit: false,
  };
}
