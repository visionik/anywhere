import { describe, it, expect, vi } from 'vitest';
import { LocationSource } from '../src/location-source';
import type { Position } from '../src/types/position';

// Minimal concrete implementation for testing
class StubSource extends LocationSource {
  override readonly sourceId = 'stub';
  override start(): void {
    /* no-op */
  }
  override stop(): void {
    /* no-op */
  }
  triggerPosition(pos: Position): void {
    this.emitPosition(pos);
  }
  triggerError(err: Error): void {
    this.emitError(err);
  }
  triggerStatus(connected: boolean, quality: number): void {
    this.emitStatus({ connected, quality });
  }
}

const makePosition = (overrides: Partial<Position> = {}): Position => ({
  latitude: 37.7749,
  longitude: -122.4194,
  timestamp: new Date(),
  source: 'stub',
  ...overrides,
});

describe('LocationSource', () => {
  describe('emitPosition', () => {
    it('calls onPosition with the given position', () => {
      const source = new StubSource();
      const handler = vi.fn();
      source.onPosition = handler;
      const pos = makePosition();
      source.triggerPosition(pos);
      expect(handler).toHaveBeenCalledWith(pos);
    });

    it('does not throw when onPosition is not set', () => {
      const source = new StubSource();
      expect(() => source.triggerPosition(makePosition())).not.toThrow();
    });
  });

  describe('emitError', () => {
    it('calls onError with the given error', () => {
      const source = new StubSource();
      const handler = vi.fn();
      source.onError = handler;
      const err = new Error('connection failed');
      source.triggerError(err);
      expect(handler).toHaveBeenCalledWith(err);
    });

    it('does not throw when onError is not set', () => {
      const source = new StubSource();
      expect(() => source.triggerError(new Error('test'))).not.toThrow();
    });
  });

  describe('emitStatus', () => {
    it('calls onStatus with connected=true and quality', () => {
      const source = new StubSource();
      const handler = vi.fn();
      source.onStatus = handler;
      source.triggerStatus(true, 0.9);
      expect(handler).toHaveBeenCalledWith({ connected: true, quality: 0.9 });
    });

    it('calls onStatus with connected=false', () => {
      const source = new StubSource();
      const handler = vi.fn();
      source.onStatus = handler;
      source.triggerStatus(false, 0);
      expect(handler).toHaveBeenCalledWith({ connected: false, quality: 0 });
    });

    it('does not throw when onStatus is not set', () => {
      const source = new StubSource();
      expect(() => source.triggerStatus(true, 1)).not.toThrow();
    });
  });

  it('exposes a sourceId property', () => {
    const source = new StubSource();
    expect(source.sourceId).toBe('stub');
  });
});
