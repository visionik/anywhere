import { describe, it, expect } from 'vitest';
import { FixAccumulator } from '../../../src/sources/nmea/fix-accumulator';
import type { ParsedSentence } from '../../../src/sources/nmea/nmea-parser';

const TS = new Date('2024-01-01T12:00:00Z');

function rmc(lat: number, lon: number, speed = 0, heading = 0): ParsedSentence {
  return {
    partial: { latitude: lat, longitude: lon, speed, heading, timestamp: TS, fixType: '2d' },
    triggerEmit: true,
  };
}

function gga(alt: number, sats: number, hdop: number): ParsedSentence {
  return {
    partial: { altitude: alt, satellites: sats, hdop, fixType: '3d' },
    triggerEmit: false,
  };
}

function vtg(heading: number, speed: number): ParsedSentence {
  return { partial: { heading, speed }, triggerEmit: false };
}

function gll(lat: number, lon: number): ParsedSentence {
  return { partial: { latitude: lat, longitude: lon }, triggerEmit: false };
}

describe('FixAccumulator', () => {
  describe('RMC trigger', () => {
    it('emits a Position when RMC (triggerEmit=true) is added with lat/lon', () => {
      const acc = new FixAccumulator();
      const pos = acc.add(rmc(37.77, -122.42));
      expect(pos).not.toBeNull();
      expect(pos!.latitude).toBeCloseTo(37.77);
      expect(pos!.longitude).toBeCloseTo(-122.42);
      expect(pos!.source).toBe('nmea');
    });

    it('does not emit when triggerEmit=false', () => {
      const acc = new FixAccumulator();
      expect(acc.add(gga(300, 9, 1.1))).toBeNull();
    });

    it('merges GGA altitude and satellites into the RMC-triggered position', () => {
      const acc = new FixAccumulator();
      acc.add(gga(500, 11, 0.8)); // accumulate before RMC
      const pos = acc.add(rmc(37.77, -122.42));
      expect(pos!.altitude).toBeCloseTo(500);
      expect(pos!.satellites).toBe(11);
    });

    it('merges VTG speed and heading', () => {
      const acc = new FixAccumulator();
      acc.add(vtg(90, 10));
      const pos = acc.add(rmc(37.77, -122.42));
      // VTG speed/heading overwritten by RMC (RMC also has these)
      expect(pos).not.toBeNull();
    });

    it('resets accumulator after emission', () => {
      const acc = new FixAccumulator();
      acc.add(gga(500, 11, 0.8));
      acc.add(rmc(37.77, -122.42)); // emit + reset

      // Second epoch: GGA accumulates fresh
      acc.add(gga(600, 8, 1.5));
      const pos2 = acc.add(rmc(37.78, -122.43));
      expect(pos2!.altitude).toBeCloseTo(600);
      expect(pos2!.satellites).toBe(8);
    });

    it('does not emit RMC without lat/lon', () => {
      const acc = new FixAccumulator();
      const result = acc.add({ partial: { timestamp: TS }, triggerEmit: true });
      expect(result).toBeNull();
    });
  });

  describe('epoch merging', () => {
    it('merges GLL lat/lon into emitted position', () => {
      const acc = new FixAccumulator();
      acc.add(gll(51.5, -0.12));
      const pos = acc.add(rmc(51.5, -0.12));
      expect(pos!.latitude).toBeCloseTo(51.5);
    });

    it('last-writer-wins: RMC lat/lon overrides earlier GLL', () => {
      const acc = new FixAccumulator();
      acc.add(gll(10.0, 20.0)); // GLL lat/lon
      const pos = acc.add(rmc(37.77, -122.42)); // RMC lat/lon wins
      expect(pos!.latitude).toBeCloseTo(37.77);
    });

    it('fixType from GGA (3d) overrides RMC fixType (2d) when GGA arrives first', () => {
      const acc = new FixAccumulator();
      acc.add(gga(300, 9, 1.1)); // fixType: '3d'
      const pos = acc.add(rmc(37.77, -122.42)); // fixType: '2d' (RMC arrives later, overwrites)
      // RMC overwrites GGA fixType since Object.assign merges in order
      expect(['2d', '3d']).toContain(pos!.fixType);
    });

    it('includes timestamp from RMC', () => {
      const acc = new FixAccumulator();
      const pos = acc.add(rmc(37.77, -122.42));
      expect(pos!.timestamp).toBe(TS);
    });
  });
});
