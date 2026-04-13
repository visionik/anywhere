import { describe, it, expect, vi } from 'vitest';
import { TypedEmitter } from '../../src/emitter/typed-emitter';

type TestEvents = {
  data: [string];
  count: [number];
  multi: [string, number];
  noArgs: [];
};

describe('TypedEmitter', () => {
  it('emits an event to a registered listener', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on('data', listener);
    emitter.emit('data', 'hello');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('hello');
  });

  it('emits to multiple listeners registered on the same event', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('data', a);
    emitter.on('data', b);
    emitter.emit('data', 'test');
    expect(a).toHaveBeenCalledWith('test');
    expect(b).toHaveBeenCalledWith('test');
  });

  it('removes a specific listener with off()', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on('data', listener);
    emitter.off('data', listener);
    emitter.emit('data', 'test');
    expect(listener).not.toHaveBeenCalled();
  });

  it('only removes the specified listener, leaving others intact', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const removed = vi.fn();
    const kept = vi.fn();
    emitter.on('data', removed);
    emitter.on('data', kept);
    emitter.off('data', removed);
    emitter.emit('data', 'test');
    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledWith('test');
  });

  it('does not throw when off() is called for an unregistered listener', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    expect(() => emitter.off('data', listener)).not.toThrow();
  });

  it('does not throw when emitting an event with no listeners', () => {
    const emitter = new TypedEmitter<TestEvents>();
    expect(() => emitter.emit('data', 'test')).not.toThrow();
  });

  it('passes multiple arguments correctly', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on('multi', listener);
    emitter.emit('multi', 'hello', 42);
    expect(listener).toHaveBeenCalledWith('hello', 42);
  });

  it('handles events with no arguments', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on('noArgs', listener);
    emitter.emit('noArgs');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('returns this from on() to support chaining', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const result = emitter.on('data', vi.fn());
    expect(result).toBe(emitter);
  });

  it('returns this from off() to support chaining', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on('data', listener);
    const result = emitter.off('data', listener);
    expect(result).toBe(emitter);
  });

  it('emits independently to different event types', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const dataListener = vi.fn();
    const countListener = vi.fn();
    emitter.on('data', dataListener);
    emitter.on('count', countListener);
    emitter.emit('data', 'hello');
    expect(dataListener).toHaveBeenCalledWith('hello');
    expect(countListener).not.toHaveBeenCalled();
  });

  it('can register the same listener twice and calls it twice', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on('data', listener);
    emitter.on('data', listener);
    emitter.emit('data', 'x');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
