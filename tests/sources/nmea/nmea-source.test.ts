import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NMEASource } from '../../../src/sources/nmea/nmea-source';
import type { NmeaTransport } from '../../../src/sources/nmea/nmea-source';
import type { Position } from '../../../src/types/position';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cs(sentence: string): string {
  const content = sentence.startsWith('$') ? sentence.slice(1) : sentence;
  let xor = 0;
  for (const c of content) xor ^= c.charCodeAt(0);
  return `${sentence}*${xor.toString(16).toUpperCase().padStart(2, '0')}`;
}

const VALID_RMC = cs('$GPRMC,092204.999,A,4250.5589,S,14718.5084,E,0.00,89.68,211200,,');
const VALID_GGA = cs('$GPGGA,092204.999,4250.5589,S,14718.5084,E,1,09,1.1,300.0,M,,,,,0000');

// ─── Mock transport ───────────────────────────────────────────────────────────

function makeMockTransport(): {
  transport: NmeaTransport;
  pushLine: (line: string) => void;
  pushError: (err: Error) => void;
} {
  let lineCb: ((line: string) => void) | null = null;
  let errCb: ((err: Error) => void) | null = null;

  const transport: NmeaTransport = {
    start: vi.fn((onLine, onError) => {
      lineCb = onLine;
      errCb = onError;
    }),
    stop: vi.fn(),
  };

  return {
    transport,
    pushLine: (line) => lineCb?.(line),
    pushError: (err) => errCb?.(err),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NMEASource', () => {
  let mock: ReturnType<typeof makeMockTransport>;

  beforeEach(() => {
    mock = makeMockTransport();
  });

  it('has sourceId = "nmea"', () => {
    expect(new NMEASource({ type: 'udp', port: 10110 }, mock.transport).sourceId).toBe('nmea');
  });

  it('starts the transport on start()', () => {
    const source = new NMEASource({ type: 'udp', port: 10110 }, mock.transport);
    source.start();
    expect(mock.transport.start).toHaveBeenCalledOnce();
  });

  it('stops the transport on stop()', () => {
    const source = new NMEASource({ type: 'udp', port: 10110 }, mock.transport);
    source.start();
    source.stop();
    expect(mock.transport.stop).toHaveBeenCalledOnce();
  });

  it('emits a Position when a valid RMC sentence is received', () => {
    const source = new NMEASource({ type: 'udp', port: 10110 }, mock.transport);
    const posHandler = vi.fn();
    source.onPosition = posHandler;
    source.start();
    mock.pushLine(VALID_RMC);
    expect(posHandler).toHaveBeenCalledOnce();
    expect((posHandler.mock.calls[0][0] as Position).source).toBe('nmea');
  });

  it('merges GGA altitude when GGA precedes RMC in same epoch', () => {
    const source = new NMEASource({ type: 'udp', port: 10110 }, mock.transport);
    const posHandler = vi.fn();
    source.onPosition = posHandler;
    source.start();
    mock.pushLine(VALID_GGA); // altitude = 300m
    mock.pushLine(VALID_RMC); // triggers emission
    const pos: Position = posHandler.mock.calls[0][0];
    expect(pos.altitude).toBeCloseTo(300.0);
    expect(pos.satellites).toBe(9);
  });

  it('discards sentences with invalid checksum', () => {
    const source = new NMEASource({ type: 'udp', port: 10110 }, mock.transport);
    const posHandler = vi.fn();
    source.onPosition = posHandler;
    source.start();
    mock.pushLine('$GPRMC,092204.999,A,4250.5589,S,14718.5084,E,0.00,89.68,211200,,*FF');
    expect(posHandler).not.toHaveBeenCalled();
  });

  it('calls onError when the transport fires an error', () => {
    const source = new NMEASource({ type: 'udp', port: 10110 }, mock.transport);
    const errHandler = vi.fn();
    source.onError = errHandler;
    source.start();
    mock.pushError(new Error('connection refused'));
    expect(errHandler).toHaveBeenCalledWith(expect.any(Error));
  });

  it('accumulates multiple sentences across an epoch', () => {
    const source = new NMEASource({ type: 'udp', port: 10110 }, mock.transport);
    const posHandler = vi.fn();
    source.onPosition = posHandler;
    source.start();

    const vtg = cs('$GPVTG,090.0,T,089.5,M,010.0,N,018.5,K,A');
    const gsa = cs('$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1');

    mock.pushLine(VALID_GGA); // altitude, satellites, hdop
    mock.pushLine(vtg); // heading, speed
    mock.pushLine(gsa); // fixType, hdop
    mock.pushLine(VALID_RMC); // triggers emission

    expect(posHandler).toHaveBeenCalledOnce();
    const pos: Position = posHandler.mock.calls[0][0];
    expect(pos.altitude).toBeCloseTo(300.0);
  });
});
