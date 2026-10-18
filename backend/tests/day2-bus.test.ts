import { describe, expect, it } from 'vitest';
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
});
