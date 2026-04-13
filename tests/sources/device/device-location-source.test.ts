import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeviceLocationSource } from '../../../src/sources/device/device-location-source';
import type { Position } from '../../../src/types/position';

// ─── Geolocation mock helpers ──────────────────────────────────────────────

type PositionCallback = (pos: GeolocationPosition) => void;
type ErrorCallback = (err: GeolocationPositionError) => void;

function makeCoords(overrides: Partial<GeolocationCoordinates> = {}): GeolocationCoordinates {
  return {
    latitude: 37.7749,
    longitude: -122.4194,
    altitude: 30,
    speed: 5.5,
    heading: 180,
    accuracy: 15,
    altitudeAccuracy: 8,
    ...overrides,
  } as GeolocationCoordinates;
}

function makeGeoPos(coords: GeolocationCoordinates, timestamp = Date.now()): GeolocationPosition {
  return { coords, timestamp } as GeolocationPosition;
}

function makePositionError(code: number, message: string): GeolocationPositionError {
  return { code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

// Mock navigator.geolocation
let watchCallback: PositionCallback | null = null;
let watchErrorCallback: ErrorCallback | null = null;
const clearWatchSpy = vi.fn();
const watchPositionSpy = vi.fn((success: PositionCallback, error?: ErrorCallback) => {
  watchCallback = success;
  watchErrorCallback = error ?? null;
  return 42; // watch ID
});
const getCurrentPositionSpy = vi.fn();

beforeEach(() => {
  watchCallback = null;
  watchErrorCallback = null;
  watchPositionSpy.mockClear();
  clearWatchSpy.mockClear();
  getCurrentPositionSpy.mockClear();

  vi.stubGlobal('navigator', {
    geolocation: {
      watchPosition: watchPositionSpy,
      getCurrentPosition: getCurrentPositionSpy,
      clearWatch: clearWatchSpy,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('DeviceLocationSource', () => {
  it('has sourceId = "device"', () => {
    expect(new DeviceLocationSource().sourceId).toBe('device');
  });

  describe('watch mode (default)', () => {
    it('calls watchPosition on start()', () => {
      const source = new DeviceLocationSource();
      source.start();
      expect(watchPositionSpy).toHaveBeenCalledOnce();
    });

    it('passes PositionOptions to watchPosition', () => {
      const source = new DeviceLocationSource({
        enableHighAccuracy: false,
        timeoutMs: 5000,
        maximumAgeMs: 1000,
      });
      source.start();
      expect(watchPositionSpy).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function),
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 1000 },
      );
    });

    it('emits a normalized Position when watchPosition fires', () => {
      const source = new DeviceLocationSource();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();

      const coords = makeCoords();
      const ts = Date.now();
      watchCallback!(makeGeoPos(coords, ts));

      expect(posHandler).toHaveBeenCalledOnce();
      const pos: Position = posHandler.mock.calls[0][0];
      expect(pos.source).toBe('device');
      expect(pos.latitude).toBe(37.7749);
      expect(pos.longitude).toBe(-122.4194);
      expect(pos.altitude).toBe(30);
      expect(pos.speed).toBeCloseTo(5.5);
      expect(pos.heading).toBe(180);
      expect(pos.accuracy).toBe(15);
      expect(pos.verticalAccuracy).toBe(8);
      expect(pos.timestamp).toBeInstanceOf(Date);
      expect(pos.timestamp.getTime()).toBe(ts);
    });

    it('emits onStatus with connected=true when a position arrives', () => {
      const source = new DeviceLocationSource();
      const statusHandler = vi.fn();
      source.onStatus = statusHandler;
      source.start();
      watchCallback!(makeGeoPos(makeCoords({ accuracy: 5 })));
      expect(statusHandler).toHaveBeenCalledWith(
        expect.objectContaining({ connected: true }),
      );
    });

    it('sets fixType to "3d" when altitude is present', () => {
      const source = new DeviceLocationSource();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();
      watchCallback!(makeGeoPos(makeCoords({ altitude: 100 })));
      expect((posHandler.mock.calls[0][0] as Position).fixType).toBe('3d');
    });

    it('sets fixType to "2d" when altitude is null', () => {
      const source = new DeviceLocationSource();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();
      watchCallback!(makeGeoPos(makeCoords({ altitude: null as unknown as number })));
      expect((posHandler.mock.calls[0][0] as Position).fixType).toBe('2d');
    });

    it('calls onError when watchPosition fires an error', () => {
      const source = new DeviceLocationSource();
      const errHandler = vi.fn();
      source.onError = errHandler;
      source.start();
      watchErrorCallback!(makePositionError(2, 'position unavailable'));
      expect(errHandler).toHaveBeenCalledOnce();
      expect(errHandler.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('calls clearWatch on stop()', () => {
      const source = new DeviceLocationSource();
      source.start();
      source.stop();
      expect(clearWatchSpy).toHaveBeenCalledWith(42);
    });

    it('emits onStatus with connected=false on stop()', () => {
      const source = new DeviceLocationSource();
      const statusHandler = vi.fn();
      source.onStatus = statusHandler;
      source.start();
      source.stop();
      expect(statusHandler).toHaveBeenLastCalledWith({ connected: false, quality: 0 });
    });

    it('does not throw on stop() if never started', () => {
      const source = new DeviceLocationSource();
      expect(() => source.stop()).not.toThrow();
    });
  });

  describe('once mode', () => {
    it('calls getCurrentPosition instead of watchPosition', () => {
      const source = new DeviceLocationSource({ mode: 'once' });
      source.start();
      expect(getCurrentPositionSpy).toHaveBeenCalledOnce();
      expect(watchPositionSpy).not.toHaveBeenCalled();
    });
  });

  describe('unavailable environment', () => {
    it('calls onError when navigator.geolocation is not available', () => {
      vi.stubGlobal('navigator', {});
      const source = new DeviceLocationSource();
      const errHandler = vi.fn();
      source.onError = errHandler;
      source.start();
      expect(errHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('not available') }),
      );
    });
  });

  describe('field normalization edge cases', () => {
    it('omits verticalAccuracy when coords.altitudeAccuracy is null', () => {
      const source = new DeviceLocationSource();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();
      watchCallback!(makeGeoPos(makeCoords({ altitudeAccuracy: null as unknown as number })));
      expect((posHandler.mock.calls[0][0] as Position).verticalAccuracy).toBeUndefined();
    });

    it('omits speed when coords.speed is null', () => {
      const source = new DeviceLocationSource();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();
      watchCallback!(makeGeoPos(makeCoords({ speed: null as unknown as number })));
      expect((posHandler.mock.calls[0][0] as Position).speed).toBeUndefined();
    });

    it('omits heading when coords.heading is null', () => {
      const source = new DeviceLocationSource();
      const posHandler = vi.fn();
      source.onPosition = posHandler;
      source.start();
      watchCallback!(makeGeoPos(makeCoords({ heading: null as unknown as number })));
      expect((posHandler.mock.calls[0][0] as Position).heading).toBeUndefined();
    });
  });
});
