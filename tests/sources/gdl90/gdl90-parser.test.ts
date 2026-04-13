import { describe, it, expect } from 'vitest';
import {
  computeCrc16,
  buildFrame,
  extractFrames,
  parseGdl90Message,
} from '../../../src/sources/gdl90/gdl90-parser';

// ─── Encoding helpers (mirror of decode logic, for test fixture generation) ──

function encodeInt24(value: number): [number, number, number] {
  const raw = value < 0 ? value + 0x1000000 : value;
  return [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
}

/** Build a 29-byte ownship report payload. */
function buildOwnshipPayload(
  lat: number,
  lon: number,
  altFt: number,
  speedKts: number,
  trackDeg: number,
  nacP = 8,
): Uint8Array {
  const buf = new Uint8Array(29);
  buf[0] = 0x0b; // Message ID

  // Latitude (bytes 6-8)
  const [la, lb, lc] = encodeInt24(Math.round((lat * 0x800000) / 180));
  buf[6] = la;
  buf[7] = lb;
  buf[8] = lc;

  // Longitude (bytes 9-11)
  const [loa, lob, loc] = encodeInt24(Math.round((lon * 0x800000) / 180));
  buf[9] = loa;
  buf[10] = lob;
  buf[11] = loc;

  // Altitude (bytes 12-13, upper 12 bits = (altFt+1000)/25)
  const altRaw = Math.round((altFt + 1000) / 25);
  buf[12] = (altRaw >> 4) & 0xff;
  buf[13] = (altRaw & 0x0f) << 4;

  // NACp (byte 15, lower nibble)
  buf[15] = nacP & 0x0f;

  // Horizontal velocity (bytes 16-17, upper 12 bits = knots)
  const spd = Math.round(speedKts) & 0xfff;
  buf[16] = (spd >> 4) & 0xff;
  buf[17] = (spd & 0x0f) << 4;

  // Track (byte 18, 360/256 deg per LSB)
  buf[18] = Math.round((trackDeg * 256) / 360) & 0xff;

  return buf;
}

/** Build a 7-byte heartbeat payload. */
function buildHeartbeatPayload(gpsValid: boolean): Uint8Array {
  const buf = new Uint8Array(7);
  buf[0] = 0x00; // Message ID
  buf[1] = gpsValid ? 0x80 : 0x00; // bit 7 = GPS POS VALID
  return buf;
}

/** Build a 13-byte AHRS payload. */
function buildAhrsPayload(rollDeg: number, pitchDeg: number, headingDeg: number): Uint8Array {
  const buf = new Uint8Array(13);
  buf[0] = 0x65; // Message ID
  buf[1] = 0x01; // subtype AHRS

  // Roll (bytes 2-3, 0.1 deg/LSB, signed 16-bit big-endian)
  const rollRaw = Math.round(rollDeg * 10) & 0xffff;
  buf[2] = (rollRaw >> 8) & 0xff;
  buf[3] = rollRaw & 0xff;

  // Pitch (bytes 4-5)
  const pitchRaw = Math.round(pitchDeg * 10) & 0xffff;
  buf[4] = (pitchRaw >> 8) & 0xff;
  buf[5] = pitchRaw & 0xff;

  // Heading (bytes 7-8, 0.1 deg/LSB, unsigned)
  const hdgRaw = Math.round(headingDeg * 10) & 0xffff;
  buf[7] = (hdgRaw >> 8) & 0xff;
  buf[8] = hdgRaw & 0xff;

  return buf;
}

// ─── CRC ───────────────────────────────────────────────────────────────────

describe('computeCrc16', () => {
  it('returns 0 for an empty payload', () => {
    expect(computeCrc16(new Uint8Array(0))).toBe(0);
  });

  it('returns a consistent value for the same input', () => {
    const data = new Uint8Array([0x00, 0x81, 0x41, 0xdb, 0xd0, 0x08, 0x02]);
    const crc1 = computeCrc16(data);
    const crc2 = computeCrc16(data);
    expect(crc1).toBe(crc2);
  });

  it('returns a 16-bit value (0-65535)', () => {
    const crc = computeCrc16(new Uint8Array([0x0b, 0x00, 0x00, 0x00, 0x00, 0x00]));
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xffff);
  });

  it('produces different CRCs for different data', () => {
    const a = computeCrc16(new Uint8Array([0x01, 0x02]));
    const b = computeCrc16(new Uint8Array([0x02, 0x01]));
    expect(a).not.toBe(b);
  });
});

// ─── Frame building and extraction ─────────────────────────────────────────

describe('buildFrame', () => {
  it('wraps payload in 0x7E delimiters', () => {
    const frame = buildFrame(new Uint8Array([0x0b]));
    expect(frame[0]).toBe(0x7e);
    expect(frame[frame.length - 1]).toBe(0x7e);
  });

  it('byte-stuffs 0x7E in payload (escapes to 0x7D 0x5E)', () => {
    // Payload containing 0x7E to trigger stuffing
    const frame = buildFrame(new Uint8Array([0x7e, 0x00]));
    const inner = Array.from(frame.slice(1, -1));
    expect(inner).toContain(0x7d);
    expect(inner).not.toContain(0x7e); // 0x7E must not appear unescaped in body
  });

  it('byte-stuffs 0x7D in payload (escapes to 0x7D 0x5D)', () => {
    const frame = buildFrame(new Uint8Array([0x7d, 0x00]));
    const inner = Array.from(frame.slice(1, -1));
    // The first 0x7D escape byte will be present
    expect(inner[0]).toBe(0x7d);
  });
});

describe('extractFrames', () => {
  it('extracts a valid frame from a datagram', () => {
    const payload = buildHeartbeatPayload(true);
    const frame = buildFrame(payload);
    const frames = extractFrames(Buffer.from(frame));
    expect(frames).toHaveLength(1);
  });

  it('returns the original payload bytes (without delimiters or CRC)', () => {
    const payload = buildHeartbeatPayload(true);
    const datagram = buildFrame(payload);
    const [extracted] = extractFrames(Buffer.from(datagram));
    expect(extracted).toBeDefined();
    // First byte should be the message ID
    expect(extracted![0]).toBe(0x00);
  });

  it('rejects frames with invalid CRC', () => {
    const payload = buildHeartbeatPayload(true);
    const frame = Buffer.from(buildFrame(payload));
    // Corrupt a byte in the middle of the frame
    frame[2] ^= 0xff;
    const frames = extractFrames(frame);
    expect(frames).toHaveLength(0);
  });

  it('extracts multiple frames from one datagram', () => {
    const f1 = buildFrame(buildHeartbeatPayload(true));
    const f2 = buildFrame(buildHeartbeatPayload(false));
    const combined = Buffer.concat([Buffer.from(f1), Buffer.from(f2)]);
    const frames = extractFrames(combined);
    expect(frames).toHaveLength(2);
  });

  it('handles empty buffer gracefully', () => {
    expect(extractFrames(Buffer.alloc(0))).toHaveLength(0);
  });
});

// ─── Heartbeat ─────────────────────────────────────────────────────────────

describe('parseGdl90Message — Heartbeat', () => {
  it('parses a valid GPS heartbeat', () => {
    const payload = buildHeartbeatPayload(true);
    const msg = parseGdl90Message(payload);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe('heartbeat');
    expect(msg!.gpsValid).toBe(true);
  });

  it('parses a heartbeat with GPS invalid', () => {
    const payload = buildHeartbeatPayload(false);
    const msg = parseGdl90Message(payload);
    expect(msg!.gpsValid).toBe(false);
  });
});

// ─── Ownship report ────────────────────────────────────────────────────────

describe('parseGdl90Message — Ownship Report', () => {
  it('decodes latitude correctly', () => {
    const payload = buildOwnshipPayload(37.7749, -122.4194, 1000, 120, 270);
    const msg = parseGdl90Message(payload);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe('ownship');
    expect(msg!.latitude).toBeCloseTo(37.7749, 2);
  });

  it('decodes longitude correctly', () => {
    const payload = buildOwnshipPayload(37.7749, -122.4194, 1000, 120, 270);
    const msg = parseGdl90Message(payload);
    expect(msg!.longitude).toBeCloseTo(-122.4194, 2);
  });

  it('decodes altitude from feet to meters', () => {
    const payload = buildOwnshipPayload(0, 0, 1000, 0, 0); // 1000 ft = 304.8 m
    const msg = parseGdl90Message(payload);
    expect(msg!.altitudeM).toBeCloseTo(304.8, 0);
  });

  it('decodes ground speed from knots to m/s', () => {
    const payload = buildOwnshipPayload(0, 0, 0, 60, 0); // 60 kts ≈ 30.87 m/s
    const msg = parseGdl90Message(payload);
    expect(msg!.speedMs).toBeCloseTo(60 * 0.514444, 1);
  });

  it('decodes track/heading in degrees', () => {
    const payload = buildOwnshipPayload(0, 0, 0, 0, 90);
    const msg = parseGdl90Message(payload);
    expect(msg!.heading).toBeCloseTo(90, 0);
  });

  it('handles negative latitude (southern hemisphere)', () => {
    const payload = buildOwnshipPayload(-33.8688, 151.2093, 500, 250, 45); // Sydney
    const msg = parseGdl90Message(payload);
    expect(msg!.latitude).toBeCloseTo(-33.8688, 2);
    expect(msg!.longitude).toBeCloseTo(151.2093, 2);
  });
});

// ─── AHRS ──────────────────────────────────────────────────────────────────

describe('parseGdl90Message — AHRS', () => {
  it('decodes roll, pitch, and heading', () => {
    const payload = buildAhrsPayload(5.5, -2.3, 180.0);
    const msg = parseGdl90Message(payload);
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe('ahrs');
    expect(msg!.rollDeg).toBeCloseTo(5.5, 1);
    expect(msg!.pitchDeg).toBeCloseTo(-2.3, 1);
    expect(msg!.headingDeg).toBeCloseTo(180.0, 1);
  });

  it('returns null roll when value is 0x7FFF (invalid sentinel)', () => {
    const buf = buildAhrsPayload(0, 0, 0);
    buf[2] = 0x7f;
    buf[3] = 0xff; // roll = 0x7FFF = invalid
    const msg = parseGdl90Message(buf);
    expect(msg!.rollDeg).toBeUndefined();
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('extractFrames — edge cases', () => {
  it('skips a frame body ending with a lone 0x7D escape byte (truncated)', () => {
    // Manually craft: 0x7E | 0xAA | 0x7D | 0x7E (0x7D with no following byte)
    const truncated = Buffer.from([0x7e, 0xaa, 0x7d, 0x7e]);
    // No valid CRC can match, so 0 frames returned
    const frames = extractFrames(truncated);
    expect(frames).toHaveLength(0);
  });
});

describe('parseGdl90Message — ownship altitude invalid sentinel', () => {
  it('returns undefined altitudeM when altitude field is 0xFFF', () => {
    const buf = new Uint8Array(29);
    buf[0] = 0x0b;
    // Set altitude bytes 12-13 to encode altRaw = 0xFFF
    buf[12] = 0xff;
    buf[13] = 0xf0; // (0xff << 4) | (0xf0 >> 4) = 0xFFF
    const msg = parseGdl90Message(buf);
    expect(msg!.altitudeM).toBeUndefined();
  });
});

// ─── Unknown messages ──────────────────────────────────────────────────────

describe('parseGdl90Message — unknown', () => {
  it('returns type "unknown" for unrecognised message IDs', () => {
    const msg = parseGdl90Message(new Uint8Array([0xAA]));
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe('unknown');
  });

  it('returns null for an empty payload', () => {
    expect(parseGdl90Message(new Uint8Array(0))).toBeNull();
  });
});
