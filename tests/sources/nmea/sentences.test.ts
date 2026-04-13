import { describe, it, expect } from 'vitest';
import { validateChecksum, parseSentence } from '../../../src/sources/nmea/nmea-parser';

// ─── Test helpers ───────────────────────────────────────────────────────────

/** Compute and append NMEA checksum: $...*XX */
function cs(sentence: string): string {
  const content = sentence.startsWith('$') ? sentence.slice(1) : sentence;
  let xor = 0;
  for (const c of content) xor ^= c.charCodeAt(0);
  return `${sentence}*${xor.toString(16).toUpperCase().padStart(2, '0')}`;
}

// ─── validateChecksum ───────────────────────────────────────────────────────

describe('validateChecksum', () => {
  it('accepts a sentence with a correct checksum', () => {
    expect(validateChecksum(cs('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,'))).toBe(true);
  });

  it('rejects a sentence with a wrong checksum', () => {
    const bad = cs('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,').replace(/\*[0-9A-F]+$/, '*00');
    expect(validateChecksum(bad)).toBe(false);
  });

  it('rejects a sentence with no checksum marker', () => {
    expect(validateChecksum('$GPRMC,123519')).toBe(false);
  });

  it('handles lower-case hex checksum', () => {
    const s = cs('$GPGLL,4916.45,N,12311.12,W,225444,A');
    const lower = s.replace(/\*[0-9A-F]+$/, (m) => m.toLowerCase());
    expect(validateChecksum(lower)).toBe(true);
  });
});

// ─── RMC ───────────────────────────────────────────────────────────────────

describe('parseSentence — RMC', () => {
  const valid = cs('$GPRMC,092204.999,A,4250.5589,S,14718.5084,E,0.00,89.68,211200,,');

  it('returns triggerEmit=true for active RMC', () => {
    const result = parseSentence(valid);
    expect(result).not.toBeNull();
    expect(result!.triggerEmit).toBe(true);
  });

  it('decodes latitude (S hemisphere)', () => {
    const result = parseSentence(valid);
    // 4250.5589 S = -(42 + 50.5589/60) ≈ -42.843 degrees
    expect(result!.partial.latitude).toBeCloseTo(-42.843, 2);
  });

  it('decodes longitude (E hemisphere)', () => {
    const result = parseSentence(valid);
    // 14718.5084 E = 147 + 18.5084/60 ≈ 147.308 degrees
    expect(result!.partial.longitude).toBeCloseTo(147.308, 2);
  });

  it('converts speed from knots to m/s', () => {
    const result = parseSentence(valid);
    // 0.00 knots = 0 m/s
    expect(result!.partial.speed).toBeCloseTo(0, 2);
  });

  it('decodes course/heading', () => {
    const result = parseSentence(valid);
    expect(result!.partial.heading).toBeCloseTo(89.68, 1);
  });

  it('decodes UTC timestamp', () => {
    const result = parseSentence(valid);
    expect(result!.partial.timestamp).toBeInstanceOf(Date);
  });

  it('returns triggerEmit=false for void RMC (status V)', () => {
    const voidRmc = cs('$GPRMC,092204.999,V,4250.5589,S,14718.5084,E,0.00,89.68,211200,,');
    const result = parseSentence(voidRmc);
    expect(result!.triggerEmit).toBe(false);
  });

  it('works with GN (GNSS) talker ID', () => {
    const gnRmc = cs('$GNRMC,092204.999,A,4250.5589,S,14718.5084,E,0.00,89.68,211200,,');
    const result = parseSentence(gnRmc);
    expect(result).not.toBeNull();
    expect(result!.partial.latitude).toBeCloseTo(-42.843, 2);
  });
});

// ─── GGA ───────────────────────────────────────────────────────────────────

describe('parseSentence — GGA', () => {
  const gga = cs('$GPGGA,092204.999,4250.5589,S,14718.5084,E,1,09,1.1,300.0,M,,,,,0000');

  it('decodes altitude in meters', () => {
    const result = parseSentence(gga);
    expect(result!.partial.altitude).toBeCloseTo(300.0, 1);
  });

  it('decodes satellite count', () => {
    const result = parseSentence(gga);
    expect(result!.partial.satellites).toBe(9);
  });

  it('decodes HDOP', () => {
    const result = parseSentence(gga);
    expect(result!.partial.hdop).toBeCloseTo(1.1, 1);
  });

  it('sets fixType to "3d" for fix quality >= 1', () => {
    const result = parseSentence(gga);
    expect(result!.partial.fixType).toBe('3d');
  });

  it('sets fixType to "dgps" for fix quality 2', () => {
    const dgps = cs('$GPGGA,092204.999,4250.5589,S,14718.5084,E,2,09,1.1,300.0,M,,,,,0000');
    expect(parseSentence(dgps)!.partial.fixType).toBe('dgps');
  });

  it('sets triggerEmit=false (GGA never triggers independently)', () => {
    const result = parseSentence(gga);
    expect(result!.triggerEmit).toBe(false);
  });
});

// ─── VTG ───────────────────────────────────────────────────────────────────

describe('parseSentence — VTG', () => {
  it('decodes true track as heading', () => {
    const vtg = cs('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K,A');
    const result = parseSentence(vtg);
    expect(result!.partial.heading).toBeCloseTo(54.7, 1);
  });

  it('converts ground speed from knots to m/s', () => {
    const vtg = cs('$GPVTG,054.7,T,034.4,M,010.0,N,018.5,K,A');
    const result = parseSentence(vtg);
    expect(result!.partial.speed).toBeCloseTo(10.0 * 0.514444, 2);
  });

  it('sets triggerEmit=false', () => {
    const vtg = cs('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K,A');
    expect(parseSentence(vtg)!.triggerEmit).toBe(false);
  });
});

// ─── GSA ───────────────────────────────────────────────────────────────────

describe('parseSentence — GSA', () => {
  it('decodes HDOP', () => {
    const gsa = cs('$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1');
    const result = parseSentence(gsa);
    expect(result!.partial.hdop).toBeCloseTo(1.3, 1);
  });

  it('maps fix type 3 to "3d"', () => {
    const gsa = cs('$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1');
    expect(parseSentence(gsa)!.partial.fixType).toBe('3d');
  });

  it('maps fix type 2 to "2d"', () => {
    const gsa = cs('$GPGSA,A,2,04,05,,09,,,,,,,,,2.5,1.3,2.1');
    expect(parseSentence(gsa)!.partial.fixType).toBe('2d');
  });

  it('maps fix type 1 to "none"', () => {
    const gsa = cs('$GPGSA,A,1,,,,,,,,,,,,,,,,');
    expect(parseSentence(gsa)!.partial.fixType).toBe('none');
  });
});

// ─── GLL ───────────────────────────────────────────────────────────────────

describe('parseSentence — GLL', () => {
  it('decodes latitude and longitude', () => {
    const gll = cs('$GPGLL,4916.45,N,12311.12,W,225444,A');
    const result = parseSentence(gll);
    expect(result!.partial.latitude).toBeCloseTo(49.274, 2);
    expect(result!.partial.longitude).toBeCloseTo(-123.185, 2);
  });

  it('sets triggerEmit=false', () => {
    const gll = cs('$GPGLL,4916.45,N,12311.12,W,225444,A');
    expect(parseSentence(gll)!.triggerEmit).toBe(false);
  });

  it('returns null for void GLL', () => {
    const voidGll = cs('$GPGLL,4916.45,N,12311.12,W,225444,V');
    const result = parseSentence(voidGll);
    expect(result).toBeNull();
  });
});

// ─── Direct parser tests (null-guard + field-fallback branches) ─────────────

import { parseRmc } from '../../../src/sources/nmea/sentences/rmc';
import { parseGga } from '../../../src/sources/nmea/sentences/gga';
import { parseVtg } from '../../../src/sources/nmea/sentences/vtg';
import { parseGsa } from '../../../src/sources/nmea/sentences/gsa';
import { parseGll } from '../../../src/sources/nmea/sentences/gll';
import { parseNmeaCoord, parseNmeaTime } from '../../../src/sources/nmea/nmea-parser';

describe('parseRmc — direct (field guards)', () => {
  it('returns null when fields.length < 10', () => {
    expect(parseRmc(['$GPRMC', '092204'])).toBeNull();
  });
  it('handles empty speed and course fields', () => {
    const f = ['$GPRMC','092204','A','4250.5589','S','14718.5084','E','','','211200','',];
    const r = parseRmc(f);
    expect(r!.partial.speed).toBeUndefined();
    expect(r!.partial.heading).toBeUndefined();
  });
  it('handles invalid lat (empty raw) — triggerEmit=false', () => {
    const f = ['$GPRMC','092204','A','','N','','E','0','0','211200','',];
    expect(parseRmc(f)!.triggerEmit).toBe(false);
  });
});

describe('parseGga — direct (field guards)', () => {
  it('returns null when fields.length < 10', () => {
    expect(parseGga(['$GPGGA', '092204'])).toBeNull();
  });
  it('handles empty satellite and hdop fields', () => {
    const f = ['$GPGGA','092204','4250.5589','S','14718.5084','E','1','','','300.0','M','','','','',];
    const r = parseGga(f);
    expect(r!.partial.satellites).toBeUndefined();
    expect(r!.partial.hdop).toBeUndefined();
  });
  it('handles empty altitude field', () => {
    const f = ['$GPGGA','092204','4250.5589','S','14718.5084','E','1','09','1.1','','M','','','','',];
    expect(parseGga(f)!.partial.altitude).toBeUndefined();
  });
  it('handles unmapped fix quality (maps to "3d" default)', () => {
    const f = ['$GPGGA','092204','4250.5589','S','14718.5084','E','8','09','1.1','300.0','M','','','','',];
    expect(parseGga(f)!.partial.fixType).toBe('3d');
  });
  it('handles fix quality 6 (estimated/dead-reckoning) → "2d"', () => {
    const f = ['$GPGGA','092204','4250.5589','S','14718.5084','E','6','09','1.1','300.0','M','','','','',];
    expect(parseGga(f)!.partial.fixType).toBe('2d');
  });
  it('handles fix quality 5 (float RTK) → "3d"', () => {
    const f = ['$GPGGA','092204','4250.5589','S','14718.5084','E','5','09','1.1','300.0','M','','','','',];
    expect(parseGga(f)!.partial.fixType).toBe('3d');
  });
});

describe('parseVtg — direct (field guards)', () => {
  it('returns null when fields.length < 8', () => {
    expect(parseVtg(['$GPVTG', '054'])).toBeNull();
  });
});

describe('parseGsa — direct (field guards)', () => {
  it('returns null when fields.length < 17', () => {
    expect(parseGsa(['$GPGSA', 'A', '3'])).toBeNull();
  });
  it('handles empty hdop field', () => {
    const f = ['$GPGSA','A','3','','','','','','','','','','','','','','',];
    expect(parseGsa(f)!.partial.hdop).toBeUndefined();
  });
});

describe('parseGll — direct (field guards)', () => {
  it('returns null when fields.length < 6', () => {
    expect(parseGll(['$GPGLL', '4916.45'])).toBeNull();
  });
  it('returns null when lat/lon are empty (NaN)', () => {
    expect(parseGll(['$GPGLL','','N','','W','225444','A'])).toBeNull();
  });
});

describe('parseNmeaCoord', () => {
  it('returns NaN for empty string', () => {
    expect(parseNmeaCoord('', 'N')).toBeNaN();
  });
  it('returns NaN when dot index < 2 (malformed)', () => {
    expect(parseNmeaCoord('1.5', 'N')).toBeNaN();
  });
});

describe('parseNmeaTime', () => {
  it('parses time without date using todays UTC date', () => {
    const d = parseNmeaTime('120000.000');
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCHours()).toBe(12);
  });
});

// ─── Edge cases for sentence field coverage ────────────────────────────────

describe('parseSentence — field edge cases', () => {
  it('RMC with empty lat/lon fields returns partial with undefined coords', () => {
    const r = cs('$GPRMC,092204,A,,N,,E,,,211200,,');
    const result = parseSentence(r);
    // Void status from empty lat/lon — triggerEmit should be false
    expect(result!.triggerEmit).toBe(false);
  });

  it('VTG with empty track field returns no heading', () => {
    const vtg = cs('$GPVTG,,T,,M,,N,,K,A');
    const result = parseSentence(vtg);
    expect(result!.partial.heading).toBeUndefined();
    expect(result!.partial.speed).toBeUndefined();
  });

  it('GSA with unknown fix type returns "none"', () => {
    const gsa = cs('$GPGSA,A,9,,,,,,,,,,,,,,,,');
    const result = parseSentence(gsa);
    expect(result!.partial.fixType).toBe('none');
  });

  it('GGA with fix quality 0 returns fixType "none"', () => {
    const gga = cs('$GPGGA,092204,0000.0000,N,00000.0000,E,0,0,,0.0,M,,,,,0000');
    const result = parseSentence(gga);
    expect(result!.partial.fixType).toBe('none');
  });

  it('GGA with RTK fix quality 4 returns fixType "rtk"', () => {
    const gga = cs('$GPGGA,092204,4250.5589,S,14718.5084,E,4,09,1.1,300.0,M,,,,,0000');
    expect(parseSentence(gga)!.partial.fixType).toBe('rtk');
  });

  it('GLL without explicit status field defaults to active', () => {
    // 5 fields only (no status)
    const gll = cs('$GPGLL,4916.45,N,12311.12,W,225444');
    const result = parseSentence(gll);
    // With 5 fields status is derived from fields[5] which is undefined → defaults to 'A'
    expect(result).not.toBeNull();
  });
});

// ─── Unknown / invalid ─────────────────────────────────────────────────────

describe('parseSentence — unknown/invalid', () => {
  it('returns null for an unknown sentence type', () => {
    expect(parseSentence(cs('$GPGSV,3,1,09,09,,,17'))).toBeNull();
  });

  it('returns null for invalid checksum', () => {
    expect(parseSentence('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,,*FF')).toBeNull();
  });

  it('returns null for a checksum of NaN (non-hex chars)', () => {
    expect(parseSentence('$GPRMC,123519*ZZ')).toBeNull();
  });
});
