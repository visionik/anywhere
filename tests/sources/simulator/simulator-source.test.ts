import { describe, it, expect, vi } from 'vitest';
import { SimulatorSource } from '../../../src/sources/simulator/simulator-source';
import type { Position } from '../../../src/types/position';

const makePos = (lat: number): Position => ({
  latitude: lat,
  longitude: 0,
  timestamp: new Date(),
  source: 'simulator',
});

const ROUTE: Position[] = [makePos(1), makePos(2), makePos(3)];

describe('SimulatorSource', () => {
  it('has sourceId = "simulator" by default', () => {
    expect(new SimulatorSource({ route: ROUTE, intervalMs: 100 }).sourceId).toBe('simulator');
  });

  it('accepts a custom sourceId', () => {
    expect(new SimulatorSource({ route: ROUTE, intervalMs: 100, sourceId: 'gdl90' }).sourceId).toBe('gdl90');
  });

  it('emits positions with the configured sourceId', () => {
    vi.useFakeTimers();
    const source = new SimulatorSource({ route: ROUTE, intervalMs: 100, sourceId: 'custom' });
    const handler = vi.fn();
    source.onPosition = handler;
    source.start();
    vi.advanceTimersByTime(100);
    expect((handler.mock.calls[0][0] as Position).source).toBe('custom');
    vi.useRealTimers();
  });

  it('emits positions from route at the configured interval', () => {
    vi.useFakeTimers();
    const source = new SimulatorSource({ route: ROUTE, intervalMs: 100 });
    const handler = vi.fn();
    source.onPosition = handler;
    source.start();

    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as Position).latitude).toBe(1);

    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(2);
    expect((handler.mock.calls[1][0] as Position).latitude).toBe(2);

    vi.useRealTimers();
  });

  it('loops back to the start when loop=true (default)', () => {
    vi.useFakeTimers();
    const source = new SimulatorSource({ route: ROUTE, intervalMs: 100, loop: true });
    const handler = vi.fn();
    source.onPosition = handler;
    source.start();

    vi.advanceTimersByTime(400); // 4 ticks: pos 1, 2, 3, 1 (loop)
    expect(handler).toHaveBeenCalledTimes(4);
    expect((handler.mock.calls[3][0] as Position).latitude).toBe(1); // back to start

    vi.useRealTimers();
  });

  it('stops after the last position when loop=false', () => {
    vi.useFakeTimers();
    const source = new SimulatorSource({ route: ROUTE, intervalMs: 100, loop: false });
    const handler = vi.fn();
    source.onPosition = handler;
    source.start();

    vi.advanceTimersByTime(500); // 5 ticks, but only 3 positions
    expect(handler).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('emits onStatus connected=false when non-looping route is exhausted', () => {
    vi.useFakeTimers();
    const source = new SimulatorSource({ route: ROUTE, intervalMs: 100, loop: false });
    const statusHandler = vi.fn();
    source.onStatus = statusHandler;
    source.start();

    vi.advanceTimersByTime(400); // all 3 positions emitted + 1 extra tick
    const lastStatus = statusHandler.mock.calls.at(-1)?.[0] as { connected: boolean; quality: number };
    expect(lastStatus?.connected).toBe(false);

    vi.useRealTimers();
  });

  it('stop() halts emission immediately', () => {
    vi.useFakeTimers();
    const source = new SimulatorSource({ route: ROUTE, intervalMs: 100 });
    const handler = vi.fn();
    source.onPosition = handler;
    source.start();

    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(1);

    source.stop();
    vi.advanceTimersByTime(300);
    expect(handler).toHaveBeenCalledTimes(1); // no more calls after stop

    vi.useRealTimers();
  });

  it('does not throw if stop() is called before start()', () => {
    expect(() => new SimulatorSource({ route: ROUTE, intervalMs: 100 }).stop()).not.toThrow();
  });

  it('emits onStatus connected=true on first position', () => {
    vi.useFakeTimers();
    const source = new SimulatorSource({ route: ROUTE, intervalMs: 100 });
    const statusHandler = vi.fn();
    source.onStatus = statusHandler;
    source.start();
    vi.advanceTimersByTime(100);
    expect(statusHandler).toHaveBeenCalledWith({ connected: true, quality: 1 });
    vi.useRealTimers();
  });

  it('can restart after stop', () => {
    vi.useFakeTimers();
    const source = new SimulatorSource({ route: ROUTE, intervalMs: 100 });
    const handler = vi.fn();
    source.onPosition = handler;

    source.start();
    vi.advanceTimersByTime(200); // 2 positions
    source.stop();
    handler.mockClear();

    source.start(); // restart from beginning
    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as Position).latitude).toBe(1); // back to route[0]

    vi.useRealTimers();
  });
});
