/**
 * GDL-90 binary protocol parser.
 *
 * Implements frame extraction (0x7E delimiters, byte unstuffing),
 * CRC-16/CCITT-0 validation, and decoding of:
 *  - 0x00 Heartbeat
 *  - 0x0B Ownship Report
 *  - 0x65 ForeFlight AHRS extension
 *
 * Reference: FAA GDL-90 Data Interface Specification (2007-09-19)
 */

/** Decoded representation of a GDL-90 message. */
export interface Gdl90Message {
  type: 'heartbeat' | 'ownship' | 'ahrs' | 'unknown';
  messageId: number;
  // Heartbeat fields
  gpsValid?: boolean;
  // Ownship fields
  latitude?: number;   // decimal degrees WGS84
  longitude?: number;  // decimal degrees WGS84
  altitudeM?: number;  // meters MSL
  speedMs?: number;    // meters per second
  heading?: number;    // degrees true (0-360)
  nacP?: number;       // Navigation Accuracy Category for Position (0-11)
  // AHRS fields
  rollDeg?: number;    // degrees (positive = right wing down)
  pitchDeg?: number;   // degrees (positive = nose up)
  headingDeg?: number; // degrees (magnetic or true per byte 6)
}

// ─── CRC-16/CCITT (polynomial 0x1021, init 0x0000) ─────────────────────────

/**
 * Compute CRC-16 over `data` using polynomial 0x1021 (GDL-90 standard).
 * Initial value is 0x0000; no input/output reflection.
 */
export function computeCrc16(data: Uint8Array): number {
  let crc = 0x0000;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

// ─── Frame building (used by tests) ────────────────────────────────────────

/**
 * Wrap a payload in a GDL-90 frame:
 * `0x7E | byte-stuffed(payload + CRC) | 0x7E`
 *
 * Exported for use in tests to construct valid frames from scratch.
 */
export function buildFrame(payload: Uint8Array): Uint8Array {
  const crc = computeCrc16(payload);
  const withCrc = new Uint8Array(payload.length + 2);
  withCrc.set(payload);
  withCrc[payload.length] = (crc >> 8) & 0xff;
  withCrc[payload.length + 1] = crc & 0xff;

  const stuffed: number[] = [];
  for (const byte of withCrc) {
    if (byte === 0x7e || byte === 0x7d) {
      stuffed.push(0x7d, byte ^ 0x20);
    } else {
      stuffed.push(byte);
    }
  }

  return new Uint8Array([0x7e, ...stuffed, 0x7e]);
}

// ─── Frame extraction ───────────────────────────────────────────────────────

/**
 * Extract and validate all GDL-90 frames from a UDP datagram.
 *
 * Each returned `Uint8Array` is the decoded message payload (without framing
 * delimiters or CRC bytes) and has already passed CRC validation.
 */
export function extractFrames(datagram: Buffer): Uint8Array[] {
  const results: Uint8Array[] = [];
  let i = 0;

  while (i < datagram.length) {
    // Find start flag
    if (datagram[i] !== 0x7e) { i++; continue; }
    const start = i;
    i++;

    // Find end flag
    let end = -1;
    for (let j = i; j < datagram.length; j++) {
      if (datagram[j] === 0x7e) { end = j; break; }
    }
    if (end === -1) break; // No closing flag

    // Byte-unstuff the body between the two flags
    const unstuffed: number[] = [];
    for (let k = start + 1; k < end; k++) {
      const b = datagram[k] as number;
      if (b === 0x7d) {
        k++;
        if (k < end) unstuffed.push((datagram[k] as number) ^ 0x20);
      } else {
        unstuffed.push(b);
      }
    }

    // Must have at least 3 bytes (1 payload + 2 CRC)
    if (unstuffed.length < 3) { i = end + 1; continue; }

    const payload = new Uint8Array(unstuffed.slice(0, -2));
    const frameCrc = (unstuffed[unstuffed.length - 2]! << 8) | unstuffed[unstuffed.length - 1]!;
    const computedCrc = computeCrc16(payload);

    if (frameCrc === computedCrc) {
      results.push(payload);
    }

    i = end + 1;
  }

  return results;
}

// ─── Message parsing ────────────────────────────────────────────────────────

/** Decode a 24-bit big-endian two's complement integer from 3 bytes. */
function readInt24(buf: Uint8Array, offset: number): number {
  const raw = ((buf[offset]! << 16) | (buf[offset + 1]! << 8) | buf[offset + 2]!) >>> 0;
  return raw >= 0x800000 ? raw - 0x1000000 : raw;
}

/** Decode a 16-bit big-endian two's complement integer from 2 bytes. */
function readInt16(buf: Uint8Array, offset: number): number {
  const raw = (buf[offset]! << 8) | buf[offset + 1]!;
  return raw >= 0x8000 ? raw - 0x10000 : raw;
}

/**
 * Parse a validated GDL-90 message payload into a {@link Gdl90Message}.
 * Returns `null` for empty payloads.
 */
export function parseGdl90Message(payload: Uint8Array): Gdl90Message | null {
  if (payload.length === 0) return null;

  const msgId = payload[0]!;

  switch (msgId) {
    case 0x00: return parseHeartbeat(payload);
    case 0x0b: return parseOwnship(payload);
    case 0x65: return parseAhrs(payload);
    default:   return { type: 'unknown', messageId: msgId };
  }
}

// ─── Heartbeat (0x00) ────────────────────────────────────────────────────────

function parseHeartbeat(payload: Uint8Array): Gdl90Message {
  const status1 = payload[1] ?? 0;
  const gpsValid = (status1 & 0x80) !== 0;
  return { type: 'heartbeat', messageId: 0x00, gpsValid };
}

// ─── Ownship Report (0x0B) ───────────────────────────────────────────────────

/** LSB for lat/lon: 180 / 2^23 degrees */
const LAT_LON_LSB = 180 / 0x800000;
/** Feet per altitude LSB */
const ALT_LSB_FT = 25;
/** Altitude offset in feet */
const ALT_OFFSET_FT = 1000;
/** Knots to m/s conversion */
const KNOTS_TO_MS = 0.514444;
/** Track degrees per LSB (360/256) */
const TRACK_LSB_DEG = 360 / 256;
/** Invalid speed sentinel */
const SPEED_INVALID = 0xfff;
/** Invalid altitude sentinel */
const ALT_INVALID = 0xfff;

function parseOwnship(payload: Uint8Array): Gdl90Message {
  if (payload.length < 19) return { type: 'ownship', messageId: 0x0b };

  const latRaw = readInt24(payload, 6);
  const lonRaw = readInt24(payload, 9);
  const latitude = latRaw * LAT_LON_LSB;
  const longitude = lonRaw * LAT_LON_LSB;

  // Altitude: upper 12 bits of bytes 12-13
  const altRaw = ((payload[12]! << 4) | (payload[13]! >> 4)) & 0xfff;
  const altitudeM =
    altRaw !== ALT_INVALID
      ? (altRaw * ALT_LSB_FT - ALT_OFFSET_FT) * 0.3048
      : undefined;

  // Ground speed: upper 12 bits of bytes 16-17
  const speedRaw = ((payload[16]! << 4) | (payload[17]! >> 4)) & 0xfff;
  const speedMs = speedRaw !== SPEED_INVALID ? speedRaw * KNOTS_TO_MS : undefined;

  // Track: byte 18
  const heading = payload[18]! * TRACK_LSB_DEG;

  // NACp: lower nibble of byte 15
  const nacP = payload[15]! & 0x0f;

  return { type: 'ownship', messageId: 0x0b, latitude, longitude, altitudeM, speedMs, heading, nacP };
}

// ─── ForeFlight AHRS (0x65) ──────────────────────────────────────────────────

/** AHRS invalid sentinel for roll and pitch */
const AHRS_INVALID_INT16 = 0x7fff;
/** AHRS invalid sentinel for heading */
const AHRS_INVALID_UINT16 = 0xffff;

function parseAhrs(payload: Uint8Array): Gdl90Message {
  if (payload.length < 9) return { type: 'ahrs', messageId: 0x65 };

  // Roll: bytes 2-3, signed 16-bit, 0.1 deg/LSB
  const rollRaw = readInt16(payload, 2);
  const rollDeg = rollRaw === AHRS_INVALID_INT16 ? undefined : rollRaw * 0.1;

  // Pitch: bytes 4-5, signed 16-bit, 0.1 deg/LSB
  const pitchRaw = readInt16(payload, 4);
  const pitchDeg = pitchRaw === AHRS_INVALID_INT16 ? undefined : pitchRaw * 0.1;

  // Heading: bytes 7-8, unsigned 16-bit, 0.1 deg/LSB
  const hdgRaw = ((payload[7]! << 8) | payload[8]!) & 0xffff;
  const headingDeg = hdgRaw !== AHRS_INVALID_UINT16 ? hdgRaw * 0.1 : undefined;

  return { type: 'ahrs', messageId: 0x65, rollDeg, pitchDeg, headingDeg };
}
