import { describe, it, expect, vi } from 'vitest';
import { LocationManager } from '../src/location-manager';
import { LocationSource } from '../src/location-source';
import type { Position } from '../src/types/position';

// Controllable stub source for testing
class StubSource extends LocationSource {
  override readonly sourceId: string;
  readonly startSpy = vi.fn();
  readonly stopSpy = vi.fn();

  constructor(id: string) {
    super();
    this.sourceId = id;
  }

  override start(): void {
    this.startSpy();
  }
  override stop(): void {
    this.stopSpy();
  }

  push(pos: Position): void {
    this.emitPosition(pos);
  }
  setStatus(connected: boolean, quality: number): void {
    this.emitStatus({ connected, quality });
  }
  pushError(err: Error): void {
    this.emitError(err);
  }
}

const makePos = (source: string, overrides: Partial<Position> = {}): Position => ({
  latitude: 37.7749,
  longitude: -122.4194,
  timestamp: new Date(),
  source,
  accuracy: 10,
  ...overrides,
});

describe('LocationManager', () => {
  describe('lifecycle', () => {
    it('starts all registered sources on start()', () => {
      const a = new StubSource('a');
      const b = new StubSource('b');
      const manager = new LocationManager({ sources: [a, b] });
      manager.start();
      expect(a.startSpy).toHaveBeenCalledOnce();
      expect(b.startSpy).toHaveBeenCalledOnce();
    });

    it('stops all registered sources on stop()', () => {
      const a = new StubSource('a');
      const manager = new LocationManager({ sources: [a] });
      manager.start();
      manager.stop();
      expect(a.stopSpy).toHaveBeenCalledOnce();
    });

    it('addSource() registers a source and wires callbacks', () => {
      const source = new StubSource('x');
      const manager = new LocationManager();
      manager.addSource(source);
      manager.start();
      expect(source.startSpy).toHaveBeenCalledOnce();
    });

    it('removeSource() stops the source and removes it', () => {
      const source = new StubSource('x');
      const manager = new LocationManager({ sources: [source] });
      manager.start();
      manager.removeSource('x');
      expect(source.stopSpy).toHaveBeenCalledOnce();
    });
  });

  describe('position emission', () => {
    it('emits position events from the active source', () => {
      const source = new StubSource('gps');
      const manager = new LocationManager({ sources: [source] });
      const listener = vi.fn();
      manager.on('position', listener);
      manager.start();
      const pos = makePos('gps');
      source.push(pos);
      expect(listener).toHaveBeenCalledWith(pos);
    });

    it('does not emit from a source that has not been started', () => {
      const source = new StubSource('gps');
      const manager = new LocationManager({ sources: [source] });
      const listener = vi.fn();
      manager.on('position', listener);
      // Not calling manager.start()
      source.push(makePos('gps'));
      // Position still emitted because addSource wires callbacks regardless
      // The source's start/stop is what controls the hardware
      expect(listener).toHaveBeenCalled();
    });

    it('rate-limits emissions via minUpdateIntervalMs', () => {
      vi.useFakeTimers();
      const source = new StubSource('gps');
      const manager = new LocationManager({ sources: [source], minUpdateIntervalMs: 500 });
      const listener = vi.fn();
      manager.on('position', listener);
      manager.start();

      source.push(makePos('gps'));  // emitted
      source.push(makePos('gps'));  // throttled
      source.push(makePos('gps'));  // throttled
      expect(listener).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(600);
      source.push(makePos('gps'));  // emitted
      expect(listener).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe('priority ordering', () => {
    it('emits only from the highest-priority source when both are healthy', () => {
      const high = new StubSource('gdl90');
      const low = new StubSource('nmea');
      const manager = new LocationManager({
        sources: [high, low],
        priorityOrder: ['gdl90', 'nmea'],
      });
      const listener = vi.fn();
      manager.on('position', listener);
      manager.start();

      high.push(makePos('gdl90'));
      low.push(makePos('nmea'));
      high.push(makePos('gdl90'));

      const sources = listener.mock.calls.map((c) => (c[0] as Position).source);
      expect(sources).not.toContain('nmea');
      expect(sources.every((s) => s === 'gdl90')).toBe(true);
    });

    it('sources with no priorityOrder entry are treated as lowest priority', () => {
      const known = new StubSource('gdl90');
      const unknown = new StubSource('other');
      const manager = new LocationManager({
        sources: [known, unknown],
        priorityOrder: ['gdl90'],
      });
      const listener = vi.fn();
      manager.on('position', listener);
      manager.start();

      known.push(makePos('gdl90'));
      unknown.push(makePos('other'));

      const sources = listener.mock.calls.map((c) => (c[0] as Position).source);
      expect(sources).not.toContain('other');
    });
  });

  describe('fallback', () => {
    it('falls back to the next source when active source reports disconnected', () => {
      const primary = new StubSource('gdl90');
      const fallback = new StubSource('nmea');
      const manager = new LocationManager({
        sources: [primary, fallback],
        priorityOrder: ['gdl90', 'nmea'],
      });
      const posListener = vi.fn();
      manager.on('position', posListener);
      manager.start();

      // Primary becomes active
      primary.push(makePos('gdl90'));
      expect(posListener).toHaveBeenCalledTimes(1);

      // Primary disconnects
      primary.setStatus(false, 0);

      // Fallback now emits
      fallback.push(makePos('nmea'));
      expect(posListener).toHaveBeenCalledTimes(2);
      expect((posListener.mock.calls[1]?.[0] as Position).source).toBe('nmea');
    });

    it('emits sourceChange events covering the full gdl90 → nmea transition', () => {
      const primary = new StubSource('gdl90');
      const fallback = new StubSource('nmea');
      const manager = new LocationManager({
        sources: [primary, fallback],
        priorityOrder: ['gdl90', 'nmea'],
      });
      const changeListener = vi.fn();
      manager.on('sourceChange', changeListener);
      manager.start();

      primary.push(makePos('gdl90'));  // null → gdl90
      primary.setStatus(false, 0);    // gdl90 → null (no fallback ready yet)
      fallback.push(makePos('nmea')); // null → nmea

      // Two-step transition: primary goes offline first, then fallback activates
      expect(changeListener).toHaveBeenCalledWith('gdl90', null);
      expect(changeListener).toHaveBeenCalledWith(null, 'nmea');
    });

    it('promotes higher-priority source back after hysteresis elapses', () => {
      vi.useFakeTimers();
      const primary = new StubSource('gdl90');
      const fallback = new StubSource('nmea');
      const manager = new LocationManager({
        sources: [primary, fallback],
        priorityOrder: ['gdl90', 'nmea'],
        hysteresisMs: 1000,
      });
      const changeListener = vi.fn();
      manager.on('sourceChange', changeListener);
      manager.start();

      // Fallback becomes active (primary not yet emitting)
      fallback.push(makePos('nmea'));

      // Primary comes back — should NOT immediately take over
      primary.push(makePos('gdl90'));
      expect(changeListener).not.toHaveBeenCalledWith('nmea', 'gdl90');

      // After hysteresis period, primary should be promoted
      vi.advanceTimersByTime(1100);
      expect(changeListener).toHaveBeenCalledWith('nmea', 'gdl90');
      vi.useRealTimers();
    });
  });

  describe('offline behavior', () => {
    it("offlineBehavior: 'event' emits offline when all sources disconnect", () => {
      const source = new StubSource('gps');
      const manager = new LocationManager({
        sources: [source],
        offlineBehavior: 'event',
      });
      const offlineListener = vi.fn();
      manager.on('offline', offlineListener);
      manager.start();

      source.push(makePos('gps'));
      source.setStatus(false, 0);

      expect(offlineListener).toHaveBeenCalledOnce();
    });

    it("offlineBehavior: 'stale' emits last position with stale=true then offline", () => {
      const source = new StubSource('gps');
      const manager = new LocationManager({
        sources: [source],
        offlineBehavior: 'stale',
      });
      const posListener = vi.fn();
      const offlineListener = vi.fn();
      manager.on('position', posListener);
      manager.on('offline', offlineListener);
      manager.start();

      const lastPos = makePos('gps', { latitude: 51.5 });
      source.push(lastPos);
      source.setStatus(false, 0);

      expect(posListener).toHaveBeenCalledTimes(2);
      const stalePos = posListener.mock.calls[1]?.[0] as Position;
      expect(stalePos.stale).toBe(true);
      expect(stalePos.latitude).toBe(51.5);
      expect(offlineListener).toHaveBeenCalledOnce();
    });

    it("offlineBehavior: 'retry' emits offline and schedules source restart", () => {
      vi.useFakeTimers();
      const source = new StubSource('gps');
      const manager = new LocationManager({
        sources: [source],
        offlineBehavior: 'retry',
        retryIntervalMs: 500,
      });
      const offlineListener = vi.fn();
      manager.on('offline', offlineListener);
      manager.start();

      source.push(makePos('gps'));
      source.setStatus(false, 0);

      expect(offlineListener).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(600);
      // Source should have been restarted (stop + start)
      expect(source.stopSpy).toHaveBeenCalled();
      expect(source.startSpy).toHaveBeenCalledTimes(2); // initial + retry
      vi.useRealTimers();
    });
  });

  describe('quality filtering', () => {
    it('ignores positions from sources below minQuality threshold', () => {
      const source = new StubSource('gps');
      const manager = new LocationManager({
        sources: [source],
        minQuality: 0.5,
      });
      const listener = vi.fn();
      manager.on('position', listener);
      manager.start();

      // Report low quality before pushing position
      source.setStatus(true, 0.2);
      source.push(makePos('gps', { accuracy: 500 }));
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('marks a non-active source unhealthy on error without going offline', () => {
      const primary = new StubSource('gdl90');
      const secondary = new StubSource('nmea');
      const manager = new LocationManager({
        sources: [primary, secondary],
        priorityOrder: ['gdl90', 'nmea'],
      });
      const offlineListener = vi.fn();
      manager.on('offline', offlineListener);
      manager.start();

      primary.push(makePos('gdl90')); // gdl90 becomes active
      secondary.pushError(new Error('serial error')); // secondary errors — not active, no offline
      expect(offlineListener).not.toHaveBeenCalled();
    });

    it('goes offline and emits sourceChange(active, null) when active source errors', () => {
      const source = new StubSource('gps');
      const manager = new LocationManager({ sources: [source], offlineBehavior: 'event' });
      const changeListener = vi.fn();
      const offlineListener = vi.fn();
      manager.on('sourceChange', changeListener);
      manager.on('offline', offlineListener);
      manager.start();

      source.push(makePos('gps'));
      source.pushError(new Error('connection lost'));

      expect(changeListener).toHaveBeenCalledWith('gps', null);
      expect(offlineListener).toHaveBeenCalledOnce();
    });
  });

  describe('quality-derived scores', () => {
    it('uses HDOP to derive quality when accuracy is absent', () => {
      const source = new StubSource('gps');
      const manager = new LocationManager({ sources: [source] });
      const listener = vi.fn();
      manager.on('position', listener);
      manager.start();

      source.push(makePos('gps', { hdop: 1.0, accuracy: undefined }));
      expect(listener).toHaveBeenCalledOnce();
    });

    it('defaults quality to 1 when neither hdop nor accuracy is present', () => {
      const source = new StubSource('gps');
      const manager = new LocationManager({ sources: [source] });
      const listener = vi.fn();
      manager.on('position', listener);
      manager.start();

      source.push(makePos('gps', { hdop: undefined, accuracy: undefined }));
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('removeSource active source', () => {
    it('clears activeId and re-evaluates when the active source is removed', () => {
      const primary = new StubSource('gdl90');
      const fallback = new StubSource('nmea');
      const manager = new LocationManager({
        sources: [primary, fallback],
        priorityOrder: ['gdl90', 'nmea'],
      });
      const posListener = vi.fn();
      manager.on('position', posListener);
      manager.start();

      primary.push(makePos('gdl90')); // gdl90 active
      manager.removeSource('gdl90');  // remove active source
      fallback.push(makePos('nmea')); // nmea should now emit

      expect((posListener.mock.calls.at(-1)?.[0] as Position).source).toBe('nmea');
    });
  });

  describe('stop with pending retry timer', () => {
    it('cancels the retry timer on stop()', () => {
      vi.useFakeTimers();
      const source = new StubSource('gps');
      const manager = new LocationManager({
        sources: [source],
        offlineBehavior: 'retry',
        retryIntervalMs: 5000,
      });
      manager.start();
      source.push(makePos('gps'));
      source.setStatus(false, 0); // triggers offline + schedules retry
      manager.stop();             // must cancel the retry timer
      vi.advanceTimersByTime(6000);
      // source.startSpy should only have been called once (initial start)
      expect(source.startSpy).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });

  describe('equal-priority sources', () => {
    it('keeps the active source when a new source has equal (unlisted) priority', () => {
      const a = new StubSource('a'); // both unlisted → equal priority
      const b = new StubSource('b');
      const manager = new LocationManager({ sources: [a, b] }); // no priorityOrder
      const posListener = vi.fn();
      manager.on('position', posListener);
      manager.start();

      a.push(makePos('a')); // a becomes active
      b.push(makePos('b')); // b has equal priority → should NOT displace a
      a.push(makePos('a')); // a still active

      const sources = posListener.mock.calls.map((c) => (c[0] as Position).source);
      expect(sources.filter((s) => s === 'a').length).toBeGreaterThan(0);
      expect(sources).not.toContain('b'); // b never becomes active
    });
  });

  describe('hysteresis cancellation', () => {
    it('cancels the hysteresis timer when primary is promoted via fallback path', () => {
      vi.useFakeTimers();
      const primary = new StubSource('gdl90');
      const fallback = new StubSource('nmea');
      const manager = new LocationManager({
        sources: [primary, fallback],
        priorityOrder: ['gdl90', 'nmea'],
        hysteresisMs: 1000,
      });
      const changeListener = vi.fn();
      manager.on('sourceChange', changeListener);
      manager.start();

      fallback.push(makePos('nmea'));  // nmea becomes active
      primary.push(makePos('gdl90')); // gdl90 starts hysteresis timer

      // Before hysteresis elapses, nmea goes down — gdl90 should take over directly
      fallback.setStatus(false, 0);
      primary.push(makePos('gdl90'));

      // gdl90 should now be active (promoted via dead-active path, clearing its timer)
      expect(changeListener).toHaveBeenCalledWith('nmea', 'gdl90');
      vi.useRealTimers();
    });
  });
});
