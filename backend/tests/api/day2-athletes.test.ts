import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, boot, call, Ctx, PASSWORD, uniq } from './setup';

let ctx: Ctx;
const tok: Record<string, string> = {};
beforeAll(async () => {
  ctx = await boot('day2athletes');
  for (const who of ['admin', 'manager', 'player', 'viewer']) {
    const r = await call(ctx.app, 'POST', '/api/v1/auth/login', { email: `${who}@nascon.test`, password: PASSWORD });
    tok[who] = r.body.token;
  }
});
afterAll(async () => ctx?.close());
beforeEach(async () => ctx.reset());

const follow = (id: string, who: string) => call(ctx.app, 'POST', `/api/v1/players/${id}/follow`, undefined, bearer(tok[who]));
const unfollow = (id: string, who: string) => call(ctx.app, 'DELETE', `/api/v1/players/${id}/follow`, undefined, bearer(tok[who]));
const profile = (id: string, opts = {}) => call(ctx.app, 'GET', `/api/v1/players/${id}/profile`, undefined, opts);

describe('FR-3.1 follow / unfollow', () => {
  it('follow and unfollow are idempotent per (follower, athlete) pair', async () => {
    const a = await follow('player-alpha-2', 'viewer');
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ athlete_id: 'player-alpha-2', follower_id: 'u-viewer', following: true, follower_count: 1 });
    expect((await follow('player-alpha-2', 'viewer')).body.follower_count).toBe(1);
    expect((await follow('player-alpha-2', 'manager')).body.follower_count).toBe(2);
    const u = await unfollow('player-alpha-2', 'viewer');
    expect(u.body).toMatchObject({ following: false, follower_count: 1 });
    expect((await unfollow('player-alpha-2', 'viewer')).body.follower_count).toBe(1);
  });

  it('a linked player follows as their player id and cannot follow themselves', async () => {
    expect((await follow('player-alpha-2', 'player')).body.follower_id).toBe('player-alpha-1');
    const self = await follow('player-alpha-1', 'player');
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('zero follower-count drift under a simultaneous toggle burst', async () => {
    const ops = Array.from({ length: 40 }, (_, i) => (i % 2 ? unfollow : follow)('player-beta-2', i % 4 < 2 ? 'viewer' : 'manager'));
    const res = await Promise.all(ops);
    expect(res.every((r) => r.status === 200)).toBe(true);
    const rows = await ctx.db.pool.query('SELECT count(*)::int AS n FROM follows WHERE athlete_id=$1', ['player-beta-2']);
    expect((await profile('player-beta-2')).body.follower_count).toBe(rows.rows[0].n);
    await Promise.all(Array.from({ length: 10 }, () => follow('player-beta-2', 'admin')));
    expect((await profile('player-beta-2')).body.follower_count).toBe(rows.rows[0].n + 1);
  });

  it('unknown athlete -> 404, no token -> 401, guest token -> 403', async () => {
    const nf = await follow('player-nope', 'viewer');
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('PLAYER_NOT_FOUND');
    expect((await call(ctx.app, 'POST', '/api/v1/players/player-alpha-2/follow')).status).toBe(401);
    const g = await call(ctx.app, 'POST', '/api/v1/players/player-alpha-2/follow', undefined, bearer('guest_anon_tok_7721'));
    expect(g.status).toBe(403);
    expect(g.body.error.code).toBe('GUEST_WRITE_FORBIDDEN');
  });
});

describe('FR-3.1 athlete profile', () => {
  it('aggregates club, career record, upcoming fixtures and VOD archive', async () => {
    const r = await profile('player-alpha-1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ athlete_id: 'player-alpha-1', club: { club_id: 'club-alpha-1' }, follower_count: 0, following: false });
    const { played, won, drawn, lost } = r.body.career;
    expect(played).toBe(won + drawn + lost);
    expect(played).toBe(r.body.vod_archive.length);
    for (const v of r.body.vod_archive) expect(v.vod_url).toBe(`/web/matches/${v.match_id}/vod`);
    expect(Array.isArray(r.body.upcoming_fixtures)).toBe(true);
  });

  it('counts a newly completed match and lists ended streams', async () => {
    const before = (await profile('player-alpha-1')).body.career.played;
    await call(ctx.app, 'POST', '/audit/v1/events', { event_id: uniq('e'), match_id: 'match-m1', type: 'match_end', payload: {} });
    const after = await profile('player-alpha-1');
    expect(after.body.career.played).toBe(before + 1);
    expect(after.body.vod_archive.some((v: any) => v.match_id === 'match-m1')).toBe(true);
    await call(ctx.app, 'POST', '/audit/v1/stream/key', { action: 'generate', player_id: 'player-alpha-1' });
    await call(ctx.app, 'POST', '/audit/v1/stream/key', { action: 'revoke', player_id: 'player-alpha-1' });
    expect((await profile('player-alpha-1')).body.past_streams[0]).toMatchObject({ status: 'revoked' });
  });

  it('reports whether the viewer follows; bad or guest tokens view anonymously; unknown -> 404', async () => {
    await follow('player-alpha-2', 'viewer');
    expect((await profile('player-alpha-2', bearer(tok.viewer))).body.following).toBe(true);
    expect((await profile('player-alpha-2', bearer('not-a-jwt'))).body.following).toBe(false);
    expect((await profile('player-alpha-2', bearer('guest_anon_tok_7721'))).status).toBe(200);
    expect((await profile('player-nope')).status).toBe(404);
  });
});
