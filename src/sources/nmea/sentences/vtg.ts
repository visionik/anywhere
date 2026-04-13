import type { ParsedSentence } from '../nmea-parser.js';

/**
 * Parse a VTG (Track Made Good and Ground Speed) sentence.
 * Fields: $xxVTG,trueTrack,T,magTrack,M,speedKnots,N,speedKph,K[,mode]*xx
 */
export function parseVtg(fields: string[]): ParsedSentence | null {
  if (fields.length < 8) return null;

  const trueTrack = fields[1] ? parseFloat(fields[1]) : undefined;
  const speedKts = fields[5] ? parseFloat(fields[5]) : undefined;
  const speed = speedKts !== undefined && !isNaN(speedKts) ? speedKts * 0.514444 : undefined;

  return {
    partial: {
      heading: trueTrack !== undefined && !isNaN(trueTrack) ? trueTrack : undefined,
      speed,
    },
    triggerEmit: false,
  };
}
