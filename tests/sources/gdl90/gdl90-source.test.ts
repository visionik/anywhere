import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { GDL90Source } from '../../../src/sources/gdl90/gdl90-source';
import { buildFrame } from '../../../src/sources/gdl90/gdl90-parser';
import type { Position } from '../../../src/types/position';

// ─── dgram mock ─────────────────────────────────────────────────────────────

class MockSocket extends EventEmitter {
  readonly bindSpy = vi.fn((_port: number, _addr: string, cb: () => void) => cb());
  readonly closeSpy = vi.fn();
  bind = this.bindSpy;
  close = this.closeSpy;
}

let mockSocket: MockSocket;

vi.mock('node:dgram', () => ({
  createSocket: vi.fn(() => {
    mockSocket = new MockSocket();
    return mockSocket;
  }),
}));

// ─── Payload builders ────────────────────────────────────────────────────────

function encodeInt24(value: number): [number, number, number] {
  const raw = value < 0 ? value + 0x1000000 : value;
  return [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff];
}

function makeOwnshipDatagram(lat: number, lon: number, altFt = 0, speedKts = 0, track = 0): Buffer {
  const buf = new Uint8Array(29);
  buf[0] = 0x0b;
  const [la, lb, lc] = encodeInt24(Math.round((lat * 0x800000) / 180));
  buf[6] = la; buf[7] = lb; buf[8] = lc;
  const [loa, lob, loc] = encodeInt24(Math.round((lon * 0x800000) / 180));
  buf[9] = loa; buf[10] = lob; buf[11] = loc;
  const altRaw = Math.round((altFt + 1000) / 25);
  buf[12] = (altRaw >> 4) & 0xff;
  buf[13] = (altRaw & 0x0f) << 4;
  const spd = Math.round(speedKts) & 0xfff;
  buf[16] = (spd >> 4) & 0xff;
  buf[17] = (spd & 0x0f) << 4;
  buf[18] = Math.round((track * 256) / 360) & 0xff;
  return Buffer.from(buildFrame(buf));
}

function makeHeartbeatDatagram(gpsValid: boolean): Buffer {
  const hb = new Uint8Array(7);
  hb[0] = 0x00;
  hb[1] = gpsValid ? 0x80 : 0x00;
  return Buffer.from(buildFrame(hb));
}

function makeAhrsDatagram(rollDeg: number, pitchDeg: number, headingDeg: number): Buffer {
  const buf = new Uint8Array(13);
  buf[0] = 0x65;
  buf[1] = 0x01;
  const rollRaw = Math.round(rollDeg * 10) & 0xffff;
  buf[2] = (rollRaw >> 8) & 0xff; buf[3] = rollRaw & 0xff;
  const pitchRaw = Math.round(pitchDeg * 10) & 0xffff;
  buf[4] = (pitchRaw >> 8) & 0xff; buf[5] = pitchRaw & 0xff;
  const hdgRaw = Math.round(headingDeg * 10) & 0xffff;
  buf[7] = (hdgRaw >> 8) & 0xff; buf[8] = hdgRaw & 0xff;
  return Buffer.from(buildFrame(buf));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GDL90Source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('has sourceId = "gdl90"', () => {
    expect(new GDL90Source().sourceId).toBe('gdl90');
  });

  describe('lifecycle', () => {
    it('binds to port 4000 by default on start()', () => {
      const source = new GDL90Source();
      source.start();
      expect(mockSocket.bindSpy).toHaveBeenCalledWith(4000, '0.0.0.0', expect.any(Function));
    });

    it('respects custom port and address', () => {
      const source = new GDL90Source({ port: 5000, bindAddress: '127.0.0.1' });
      source.start();
      expect(mockSocket.bindSpy).toHaveBeenCalledWith(5000, '127.0.0.1', expect.any(Function));
    });

    it('closes the socket on stop()', () => {
      const source = new GDL90Source();
      source.start();
      source.stop();
      expect(mockSocket.closeSpy).toHaveBeenCalledOnce();
    });

    it('does not throw when stop() is called before start()', () => {
      const source = new GDL90Source();
      expect(() => source.stop()).not.toThrow();
    });

    it('calls onError when socket emits an error', () => {
      const source = new GDL90Source();
      const errHandler = vi.fn();
      source.onError = errHandler;
      source.start();
      mockSocket.emit('error', new Error('EADDRINUSE'));
      expect(errHandler).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Ownship report', () => {
    it('emits a Position when a valid ownship datagram arrives', () => {
      const source = new GDL90Source();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();

      mockSocket.emit('message', makeOwnshipDatagram(37.7749, -122.4194, 1000, 120, 270));

      expect(posHandler).toHaveBeenCalledOnce();
      const pos: Position = posHandler.mock.calls[0][0];
      expect(pos.source).toBe('gdl90');
      expect(pos.latitude).toBeCloseTo(37.7749, 2);
      expect(pos.longitude).toBeCloseTo(-122.4194, 2);
      expect(pos.altitudeM ?? pos.altitude).toBeCloseTo(304.8, 0);
    });

    it('sets speed and heading on the Position', () => {
      const source = new GDL90Source();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();
      mockSocket.emit('message', makeOwnshipDatagram(0, 0, 0, 60, 90));
      const pos: Position = posHandler.mock.calls[0][0];
      expect(pos.speed).toBeCloseTo(60 * 0.514444, 1);
      expect(pos.heading).toBeCloseTo(90, 0);
    });
  });

  describe('Heartbeat', () => {
    it('emits onStatus connected=true when GPS valid bit is set', () => {
      const source = new GDL90Source();
      const statusHandler = vi.fn();
      source.onStatus = statusHandler;
      source.start();
      mockSocket.emit('message', makeHeartbeatDatagram(true));
      expect(statusHandler).toHaveBeenCalledWith(expect.objectContaining({ connected: true }));
    });

    it('emits onStatus connected=false when GPS valid bit is clear', () => {
      const source = new GDL90Source();
      const statusHandler = vi.fn();
      source.onStatus = statusHandler;
      source.start();
      mockSocket.emit('message', makeHeartbeatDatagram(false));
      expect(statusHandler).toHaveBeenCalledWith(expect.objectContaining({ connected: false }));
    });
  });

  describe('AHRS', () => {
    it('annotates the next ownship Position with AHRS roll/pitch', () => {
      const source = new GDL90Source();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();

      // AHRS arrives first, then ownship
      mockSocket.emit('message', makeAhrsDatagram(5.5, -2.3, 180));
      mockSocket.emit('message', makeOwnshipDatagram(37.0, -122.0, 1000, 100, 0));

      const pos: Position = posHandler.mock.calls[0][0];
      expect(pos.roll).toBeCloseTo(5.5, 1);
      expect(pos.pitch).toBeCloseTo(-2.3, 1);
    });

    it('clears AHRS cache after it is applied to a position', () => {
      const source = new GDL90Source();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();

      mockSocket.emit('message', makeAhrsDatagram(5.5, -2.3, 180));
      mockSocket.emit('message', makeOwnshipDatagram(37.0, -122.0, 1000, 100, 0));
      mockSocket.emit('message', makeOwnshipDatagram(37.0, -122.0, 1000, 100, 0)); // second ownship

      const pos2: Position = posHandler.mock.calls[1][0];
      expect(pos2.roll).toBeUndefined();
    });
  });
});
