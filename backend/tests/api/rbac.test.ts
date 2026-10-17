import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer, boot, call, Ctx } from './setup';

let ctx: Ctx;
let tokens: Record<string, string>;
let c: Record<string, string>;
beforeAll(async () => {
  ctx = await boot('rbac');
  const r = await call(ctx.app, 'POST', '/audit/v1/rbac-matrix');
  expect(r.status).toBe(200);
  tokens = r.body.tokens;
  c = r.body.context;
});
afterAll(async () => ctx.close());

const ROLES = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'] as const;
type Row = [string, string, string, string]; // label, method, path, expected per role as 5-char string

describe('POST /audit/v1/rbac-matrix', () => {
  it('returns 5 tokens and the seeded context', () => {
    expect(Object.keys(tokens).sort()).toEqual([...ROLES].sort());
    expect(c).toEqual({
      tenant_id: 'tenant-alpha', foreign_tenant_id: 'tenant-beta', own_league_id: 'league-alpha-1', other_league_id: 'league-alpha-2', foreign_league_id: 'league-beta-1',
      own_club_id: 'club-alpha-1', other_club_id: 'club-alpha-2', foreign_club_id: 'club-beta-1', own_player_id: 'player-alpha-1', other_player_id: 'player-alpha-2', foreign_player_id: 'player-beta-1',
    });
  });
});

describe('probe routes: spec 5.13 expected matrix', () => {
  // columns: Super Admin, Organizer, Club Mgr, Player, Viewer
  const rows = (): Row[] => [
    ['P1', 'POST', '/audit/v1/rbac/tenants', 'ADDDD'],
    ['P2 own_league', 'POST', `/audit/v1/rbac/leagues/${c.own_league_id}/fixtures`, 'AADDD'],
    ['P2 other_league', 'POST', `/audit/v1/rbac/leagues/${c.other_league_id}/fixtures`, 'ADDDD'],
    ['P2 foreign_league', 'POST', `/audit/v1/rbac/leagues/${c.foreign_league_id}/fixtures`, 'ADDDD'],
    ['P3 own_club', 'POST', `/audit/v1/rbac/clubs/${c.own_club_id}/roster`, 'ADADD'],
    ['P4 own_club', 'POST', `/audit/v1/rbac/clubs/${c.own_club_id}/products`, 'ADADD'],
    ['P3 other_club', 'POST', `/audit/v1/rbac/clubs/${c.other_club_id}/roster`, 'ADDDD'],
    ['P4 other_club', 'POST', `/audit/v1/rbac/clubs/${c.other_club_id}/products`, 'ADDDD'],
    ['P3 foreign_club', 'POST', `/audit/v1/rbac/clubs/${c.foreign_club_id}/roster`, 'ADDDD'],
    ['P4 foreign_club', 'POST', `/audit/v1/rbac/clubs/${c.foreign_club_id}/products`, 'ADDDD'],
    ['P5 own_player', 'PATCH', `/audit/v1/rbac/players/${c.own_player_id}`, 'ADAAD'],
    ['P5 other_player', 'PATCH', `/audit/v1/rbac/players/${c.other_player_id}`, 'ADDDD'],
    ['P5 foreign_player', 'PATCH', `/audit/v1/rbac/players/${c.foreign_player_id}`, 'ADDDD'],
    ['P6 own_club', 'GET', `/audit/v1/rbac/clubs/${c.own_club_id}`, 'AAAAA'],
    ['P6 other_club', 'GET', `/audit/v1/rbac/clubs/${c.other_club_id}`, 'AAAAA'],
    ['P6 foreign_club', 'GET', `/audit/v1/rbac/clubs/${c.foreign_club_id}`, 'ADDDD'],
    ['P7', 'GET', '/audit/v1/rbac/platform/config', 'ADDDD'],
  ];
  it('every probe x role matches the matrix (A -> 200 {authorized:true}, D -> 403 FORBIDDEN)', async () => {
    const mismatches: string[] = [];
    for (const [label, method, url, exp] of rows())
      for (let i = 0; i < ROLES.length; i++) {
        const r = await call(ctx.app, method, url, method === 'GET' ? undefined : {}, bearer(tokens[ROLES[i]]));
        const want = exp[i] === 'A' ? 200 : 403;
        if (r.status !== want) mismatches.push(`${label} ${ROLES[i]}: got ${r.status}`);
        if (want === 200) expect(r.body).toEqual({ authorized: true });
        else expect(r.body.error.code).toBe('FORBIDDEN');
      }
    expect(mismatches).toEqual([]);
  });
  it('unknown ids: 404 for super admin, 403 for others (authorization first)', async () => {
    const sa = await call(ctx.app, 'POST', '/audit/v1/rbac/leagues/no-such/fixtures', {}, bearer(tokens.super_admin));
    expect([sa.status, sa.body.error.code]).toEqual([404, 'LEAGUE_NOT_FOUND']);
    const cl = await call(ctx.app, 'GET', '/audit/v1/rbac/clubs/no-such', undefined, bearer(tokens.super_admin));
    expect(cl.body.error.code).toBe('CLUB_NOT_FOUND');
    const pl = await call(ctx.app, 'PATCH', '/audit/v1/rbac/players/no-such', {}, bearer(tokens.super_admin));
    expect(pl.body.error.code).toBe('PLAYER_NOT_FOUND');
    const lo = await call(ctx.app, 'POST', '/audit/v1/rbac/leagues/no-such/fixtures', {}, bearer(tokens.league_organizer));
    expect(lo.status).toBe(403);
  });
});

describe('401 UNAUTHENTICATED', () => {
  const P7 = '/audit/v1/rbac/platform/config';
  const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  it('rejects missing, malformed, tampered, alg:none and expired tokens', async () => {
    const t = tokens.super_admin;
    const [h, p, s] = t.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    const tampered = `${h}.${b64u({ ...claims, role: 'super_admin', sub: 'x' })}.${s}`;
    const badSig = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;
    const none = `${b64u({ alg: 'none', typ: 'JWT' })}.${p}.`;
    const expired = ctx.crypto.signJwt({ sub: 'u-admin', role: 'super_admin', tenant_id: null }, 'nascon-jwt|test-salt', -10);
    const wrongSecret = ctx.crypto.signJwt({ sub: 'u-admin', role: 'super_admin', tenant_id: null }, 'other-secret');
    const variants: (Record<string, string> | undefined)[] = [
      undefined,
      { authorization: 'Basic abc' },
      { authorization: 'Bearer' },
      { authorization: 'Bearer a.b' },
      { authorization: 'Bearer !!!.@@@.###' },
      { authorization: `Bearer ${tampered}` },
      { authorization: `Bearer ${badSig}` },
      { authorization: `Bearer ${none}` },
      { authorization: `Bearer ${expired}` },
      { authorization: `Bearer ${wrongSecret}` },
    ];
    for (const headers of variants) {
      const r = await call(ctx.app, 'GET', P7, undefined, headers ? { headers } : {});
      expect(r.status, JSON.stringify(headers)).toBe(401);
      expect(r.body.error.code).toBe('UNAUTHENTICATED');
    }
    // a valid token signed with the right secret works
    const fresh = ctx.crypto.signJwt({ sub: 'u-admin', role: 'super_admin', tenant_id: null }, 'nascon-jwt|test-salt');
    expect((await call(ctx.app, 'GET', P7, undefined, bearer(fresh))).status).toBe(200);
  });
});

describe('rate limit on /api/v1/ping', () => {
  it('150 calls in a burst: first is 200, >= 40 are 429 with Retry-After, and 11 s later it is 200 again', async () => {
    const ip = '172.16.99.1';
    const rs = [];
    for (let i = 0; i < 150; i++) rs.push(await ctx.app.inject({ method: 'GET', url: '/api/v1/ping', remoteAddress: ip }));
    expect(rs[0].statusCode).toBe(200);
    expect(rs[0].json()).toEqual({ pong: true });
    const limited = rs.filter((r) => r.statusCode === 429);
    expect(limited.length).toBeGreaterThanOrEqual(40);
    for (const r of limited) {
      expect(r.json().error.code).toBe('RATE_LIMITED');
      expect(Number(r.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    }
    // other clients are unaffected
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/ping', remoteAddress: '172.16.99.2' })).statusCode).toBe(200);
    // login is exempt
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'x@y.z', password: 'nope' }, remoteAddress: ip })).statusCode).toBe(401);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 11_000);
      expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/ping', remoteAddress: ip })).statusCode).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
