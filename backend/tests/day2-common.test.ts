import net from 'node:net';
import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sign } from '../src/core/crypto';
import { checkMedia, checkRedis, runHealth } from '../src/core/health';
import { GUEST_TOKEN_RE, GUEST_WRITE_EXEMPT, entityTypeOf } from '../src/features/day2/common';
import { statusFromEvent } from '../src/features/events/projection';
import { missingSalts } from '../src/core/config';

describe('Phase II signature recipe (spec Appendix A, reference salt)', () => {
  const salt = 'T01D27ad7ffff12e';
  it('vector 1: 4-key stream payload', () => {
    const payload = { action: 'rotate', player_id: 'player-alpha-1', status: 'active', stream_key: 'sk_live_9f83a1b2c3d4e5f6' };
    // digest produced by the spec's own Python reference function (sign_day2)
    expect(sign(salt, 'sk_live_9f83a1b2c3d4e5f6', payload)).toBe('9bd054eb746844b4701c6f158209c315ef2b16f392efd733bdf0715940610289');
  });
  it('vector 2: legacy 2-key payload', () => {
    expect(sign(salt, 'sk_live_101', { action: 'rotate', player_id: 'player-alpha-1' })).toBe(
      '830b24eb2c795c02c54c17516b0e96870f5b65d98d28c2f0a15619ec3e076188',
    );
  });
  it('is key-order independent and salt dependent', () => {
    const a = sign(salt, 'x', { b: 1, a: 2 });
    expect(a).toBe(sign(salt, 'x', { a: 2, b: 1 }));
    expect(a).not.toBe(sign(salt + ' ', 'x', { a: 2, b: 1 })); // salt is never trimmed
  });
});

describe('guest token matching', () => {
  it('matches only Bearer guest_anon_tok_*', () => {
    expect(GUEST_TOKEN_RE.exec('Bearer guest_anon_tok_7721')?.[1]).toBe('guest_anon_tok_7721');
    expect(GUEST_TOKEN_RE.exec('bearer   guest_anon_tok_abc')?.[1]).toBe('guest_anon_tok_abc');
    expect(GUEST_TOKEN_RE.exec('Bearer eyJhbGciOi.x.y')).toBeNull();
    expect(GUEST_TOKEN_RE.exec('guest_anon_tok_7721')).toBeNull();
    expect(GUEST_TOKEN_RE.exec('Bearer guest_anon_tok_1 extra')).toBeNull();
  });
  it('exempts only token issuing and the cart-merge probe', () => {
    expect([...GUEST_WRITE_EXEMPT].sort()).toEqual(['/api/v1/guest/session', '/audit/v1/guest/cart-merge']);
  });
  it('derives entity types from id prefixes', () => {
    expect(['match-m1', 'club-alpha-1', 'player-beta-2', 'cs-session-101', 'team-x'].map(entityTypeOf)).toEqual(['match', 'club', 'player', 'costream', null]);
  });
});

describe('status events', () => {
  it('maps every accepted spelling to the right status', () => {
    const t = (type: string, payload?: any) => statusFromEvent({ type, payload });
    expect(['match_postpone', 'match_postponed', 'postpone'].map((x) => t(x))).toEqual(['postponed', 'postponed', 'postponed']);
    expect(['match_cancel', 'match_cancelled', 'cancel'].map((x) => t(x))).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(['match_abandon', 'match_abandoned', 'abandon'].map((x) => t(x))).toEqual(['abandoned', 'abandoned', 'abandoned']);
    expect(t('status_change', { status: 'postponed' })).toBe('postponed');
    expect(t('status_change', { status: 'completed' })).toBeNull();
    expect(t('status_change', {})).toBeNull();
    expect(t('status_update', { status: 'cancelled' })).toBe('cancelled');
    expect(t('match_status', { status: 'abandoned' })).toBe('abandoned');
    expect(t('set_status', { status: 'postponed' })).toBe('postponed');
    expect(t('set_status', { status: 'in_progress' })).toBeNull();
    expect(t('score')).toBeNull();
    expect(t('constructor')).toBeNull();
  });
});

describe('health probes', () => {
  let redis: net.Server;
  let redisUrl = '';
  let httpSrv: http.Server;
  let httpUrl = '';
  let closedPort = 0;
  beforeAll(async () => {
    redis = net.createServer((s) => s.on('data', (d) => s.write(d.toString().startsWith('PING') ? '+PONG\r\n' : '-ERR\r\n')));
    await new Promise<void>((r) => redis.listen(0, '127.0.0.1', r));
    redisUrl = `redis://127.0.0.1:${(redis.address() as net.AddressInfo).port}`;
    httpSrv = http.createServer((_q, res) => res.writeHead(401).end());
    await new Promise<void>((r) => httpSrv.listen(0, '127.0.0.1', r));
    httpUrl = `http://127.0.0.1:${(httpSrv.address() as net.AddressInfo).port}`;
    const tmp = net.createServer();
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', r));
    closedPort = (tmp.address() as net.AddressInfo).port;
    await new Promise((r) => tmp.close(r));
  });
  afterAll(async () => {
    await new Promise((r) => redis.close(r));
    await new Promise((r) => httpSrv.close(r));
  });

  it('redis: PONG is up; refused, bad url and wrong reply are down', async () => {
    expect(await checkRedis(redisUrl)).toBe(true);
    expect(await checkRedis(`redis://127.0.0.1:${closedPort}`)).toBe(false);
    expect(await checkRedis('not a url')).toBe(false);
    const bad = net.createServer((s) => s.on('data', () => s.write('-ERR nope\r\n')));
    await new Promise<void>((r) => bad.listen(0, '127.0.0.1', r));
    expect(await checkRedis(`redis://127.0.0.1:${(bad.address() as net.AddressInfo).port}`)).toBe(false);
    await new Promise((r) => bad.close(r));
  });
  it('media: any HTTP answer is up, a refused connection is down', async () => {
    expect(await checkMedia(httpUrl)).toBe(true);
    expect(await checkMedia(`http://127.0.0.1:${closedPort}`)).toBe(false);
  });
  it('runHealth only probes what is configured', async () => {
    expect(await runHealth({ db: async () => true })).toEqual({ ok: true, checks: { db: 'ok', redis: 'skipped', media: 'skipped' } });
    expect((await runHealth({ db: async () => false })).ok).toBe(false);
    expect((await runHealth({ db: async () => { throw new Error('x'); } })).checks.db).toBe('down');
    expect(await runHealth({ db: async () => true, redisUrl, mediaApiUrl: httpUrl })).toEqual({ ok: true, checks: { db: 'ok', redis: 'ok', media: 'ok' } });
    const down = await runHealth({ db: async () => true, redisUrl: `redis://127.0.0.1:${closedPort}`, mediaApiUrl: httpUrl });
    expect(down).toEqual({ ok: false, checks: { db: 'ok', redis: 'down', media: 'ok' } });
  });
});

describe('missingSalts (startup warning)', () => {
  it('names each empty salt and nothing when both are set', () => {
    expect(missingSalts({ salt: '', day2Salt: '' })).toEqual(['DAY1_SALT', 'DAY2_SALT']);
    expect(missingSalts({ salt: 's1', day2Salt: '' })).toEqual(['DAY2_SALT']);
    expect(missingSalts({ salt: '', day2Salt: 's2' })).toEqual(['DAY1_SALT']);
    expect(missingSalts({ salt: 's1', day2Salt: 's2' })).toEqual([]);
  });
});
