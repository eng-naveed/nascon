import { afterEach, describe, expect, it, vi } from 'vitest';
import { publish, subscribe, subscriberCount } from '../src/features/day2/observability/bus';

describe('notification bus', () => {
  it('delivers to topic subscribers only, isolates throwing handlers, and unsubscribes', () => {
    const got: string[] = [];
    const offA = subscribe('t', (e) => got.push('a:' + e.type));
    const offBad = subscribe('t', () => {
      throw new Error('boom');
    });
    subscribe('other', (e) => got.push('o:' + e.type));
    expect(publish('t', { type: 'x' })).toBe(1);
    expect(got).toEqual(['a:x']);
    expect(subscriberCount('t')).toBe(2);
    offA();
    offBad();
    expect(subscriberCount('t')).toBe(0);
    expect(publish('t', { type: 'y' })).toBe(0);
    expect(publish('none', { type: 'z' })).toBe(0);
  });

  describe('async subscribers', () => {
    const unhandled = vi.fn();
    afterEach(() => {
      process.off('unhandledRejection', unhandled);
    });

    it('a rejecting async subscriber neither throws nor leaves an unhandled rejection; the others still receive the event', async () => {
      process.on('unhandledRejection', unhandled);
      const got: string[] = [];
      const offBad = subscribe('t-async', async () => {
        throw new Error('async boom');
      });
      const offGood = subscribe('t-async', async (e) => {
        got.push('good:' + e.type);
      });
      const offSync = subscribe('t-async', (e) => {
        got.push('sync:' + e.type);
      });
      expect(() => publish('t-async', { type: 'x' })).not.toThrow();
      // let the rejection settle and any unhandledRejection fire
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).not.toHaveBeenCalled();
      expect(got.sort()).toEqual(['good:x', 'sync:x']);
      offBad();
      offGood();
      offSync();
    });
  });
});
