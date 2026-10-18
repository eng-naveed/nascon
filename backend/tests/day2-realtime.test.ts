import { describe, expect, it } from 'vitest';
import { INVITE_TTL_MS, signInvite, verifyInvite } from '../src/features/day2/costream/live';
import { attach, broadcast, listeners } from '../src/features/day2/observability/hub';
import { getGauge } from '../src/core/metrics';

describe('signed co-stream invites (FR-3.3)', () => {
  it('round-trips and binds session, player and expiry', () => {
    const t = signInvite('cs-1', 'player-alpha-2', 1_000);
    expect(t.token).toMatch(/^inv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(t.expires_at).toBe(new Date(1_000 + INVITE_TTL_MS).toISOString());
    expect(verifyInvite(t.token, 2_000)).toEqual({ s: 'cs-1', p: 'player-alpha-2', e: 1_000 + INVITE_TTL_MS });
  });
  it('rejects expired, tampered, foreign-version and garbage tokens', () => {
    const t = signInvite('cs-1', 'player-alpha-2', 1_000).token;
    expect(verifyInvite(t, 1_000 + INVITE_TTL_MS)).toBeNull();
    const [v, p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 'cs-1', p: 'player-beta-1', e: 9e15 })).toString('base64url');
    expect(verifyInvite(`${v}.${forged}.${s}`, 2_000)).toBeNull();
    expect(verifyInvite(`${v}.${p}.${s.slice(0, -2)}xx`, 2_000)).toBeNull();
    expect(verifyInvite(`inv2.${p}.${s}`, 2_000)).toBeNull();
    expect(verifyInvite('nonsense', 2_000)).toBeNull();
    expect(verifyInvite(`inv1.${Buffer.from('not json').toString('base64url')}.x`, 2_000)).toBeNull();
  });
});

describe('hub fan-out', () => {
  it('serialises once per broadcast, tracks the connection gauge, detaches idempotently', () => {
    const before = getGauge('nascon_active_ws_connections');
    const got: string[] = [];
    const off1 = attach(['t:a', 't:b'], (m) => got.push('1' + m));
    const off2 = attach(['t:a'], () => {
      throw new Error('closing');
    });
    expect(getGauge('nascon_active_ws_connections')).toBe(before + 2);
    expect(broadcast('t:a', { type: 'x' })).toBe(1);
    expect(got).toEqual(['1{"topic":"t:a","type":"x"}']);
    expect(broadcast('t:none', { type: 'x' })).toBe(0);
    off1();
    off1();
    off2();
    expect([listeners('t:a'), listeners('t:b'), getGauge('nascon_active_ws_connections')]).toEqual([0, 0, before]);
  });
});

describe('ntfy push mirror', () => {
  it('derives stable unguessable topics and posts JSON to the ntfy root', async () => {
    const { ntfyTopic, pushNtfy } = await import('../src/features/day2/observability/ntfy');
    expect(ntfyTopic('u-player')).toMatch(/^nascon-[A-Za-z0-9_-]{22}$/);
    expect(ntfyTopic('u-player')).toBe(ntfyTopic('u-player'));
    expect(ntfyTopic('u-player')).not.toBe(ntfyTopic('u-viewer'));
    const calls: any[] = [];
    expect(await pushNtfy('u-player', 'T', 'M', 'http://ntfy:80/', async (url, init) => (calls.push([url, JSON.parse(init.body)]), { ok: true }))).toBe(true);
    expect(calls).toEqual([['http://ntfy:80/', { topic: ntfyTopic('u-player'), title: 'T', message: 'M', tags: ['sports'] }]]);
    expect(await pushNtfy('u-player', 'T', 'M', '')).toBe(false);
    expect(await pushNtfy('u-player', 'T', 'M', 'http://x', async () => { throw new Error('down'); })).toBe(false);
  });
});
