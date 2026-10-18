import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, boot, call, Ctx, PASSWORD } from './setup';

let ctx: Ctx;
const tok: Record<string, string> = {};
beforeAll(async () => {
  ctx = await boot('day2follow');
  for (const who of ['viewer', 'manager', 'player']) {
    const r = await call(ctx.app, 'POST', '/api/v1/auth/login', { email: `${who}@nascon.test`, password: PASSWORD });
    tok[who] = r.body.token;
  }
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const ATH = 'player-alpha-2';
const follow = (who: string, id = ATH) => call(ctx.app, 'POST', `/api/v1/players/${id}/follow`, undefined, bearer(tok[who]));
const unfollow = (who: string, id = ATH) => call(ctx.app, 'DELETE', `/api/v1/players/${id}/follow`, undefined, bearer(tok[who]));
const count = async (id = ATH) => (await call(ctx.app, 'GET', `/api/v1/players/${id}/followers`)).body.follower_count;

describe('athlete follow/unfollow (FR-3.1)', () => {
  it('follows idempotently and unfollows back to zero', async () => {
    const a = await follow('viewer');
    expect([a.status, a.body]).toEqual([200, { athlete_id: ATH, follower_id: 'u-viewer', following: true, follower_count: 1 }]);
    expect((await follow('viewer')).body.follower_count).toBe(1);
    expect(await count()).toBe(1);
    const p = await follow('player'); // a user with a linked player follows as that player
    expect([p.body.follower_id, p.body.follower_count]).toEqual(['player-alpha-1', 2]);
    const u = await unfollow('viewer');
    expect([u.status, u.body.following, u.body.follower_count]).toEqual([200, false, 1]);
    expect((await unfollow('viewer')).body.follower_count).toBe(1);
    await unfollow('player');
    expect(await count()).toBe(0);
  });

  it('has zero drift under concurrent follow/unfollow toggle bursts', async () => {
    const users = ['viewer', 'manager'];
    for (let round = 0; round < 3; round++) {
      const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? follow(users[i % 4 < 2 ? 0 : 1]) : unfollow(users[i % 4 < 2 ? 0 : 1]))));
      expect(rs.every((r) => r.status === 200 && r.body.follower_count >= 0 && r.body.follower_count <= users.length)).toBe(true);
      const rows = await ctx.db.pool.query('SELECT follower_id FROM follows WHERE athlete_id=$1', [ATH]);
      expect(await count()).toBe(rows.rowCount);
      // settle: a final follow by each user must land exactly on users.length
      await Promise.all(users.flatMap((u) => [follow(u), follow(u), follow(u)]));
      expect(await count()).toBe(users.length);
      await Promise.all(users.flatMap((u) => [unfollow(u), unfollow(u)]));
      expect(await count()).toBe(0);
    }
  });

  it('returns 404 PLAYER_NOT_FOUND for an unknown athlete', async () => {
    for (const r of [await follow('viewer', 'player-nope'), await unfollow('viewer', 'player-nope'), await call(ctx.app, 'GET', '/api/v1/players/player-nope/followers')]) {
      expect([r.status, r.body.error.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
    }
  });

  it('followers reports `following` for a signed-in viewer only', async () => {
    const get = (opts = {}) => call(ctx.app, 'GET', `/api/v1/players/${ATH}/followers`, undefined, opts);
    expect((await get()).body).toEqual({ athlete_id: ATH, follower_count: 0 });
    expect((await get(bearer(tok.viewer))).body.following).toBe(false);
    await follow('viewer');
    expect((await get(bearer(tok.viewer))).body).toEqual({ athlete_id: ATH, follower_count: 1, following: true });
    expect((await get(bearer(tok.manager))).body.following).toBe(false);
    expect((await get(bearer('not-a-jwt'))).body).toEqual({ athlete_id: ATH, follower_count: 1 });
    const g = (await call(ctx.app, 'POST', '/api/v1/guest/session')).body.guest_token;
    expect((await get(bearer(g))).body).toEqual({ athlete_id: ATH, follower_count: 1 });
  });

  it('requires a token to follow or unfollow and refuses guest tokens', async () => {
    expect((await call(ctx.app, 'POST', `/api/v1/players/${ATH}/follow`)).status).toBe(401);
    expect((await call(ctx.app, 'DELETE', `/api/v1/players/${ATH}/follow`)).status).toBe(401);
    const g = (await call(ctx.app, 'POST', '/api/v1/guest/session')).body.guest_token;
    for (const m of ['POST', 'DELETE']) {
      const r = await call(ctx.app, m, `/api/v1/players/${ATH}/follow`, undefined, bearer(g));
      expect([r.status, r.body.error.code]).toEqual([403, 'GUEST_WRITE_FORBIDDEN']);
    }
    expect(await count()).toBe(0);
  });
});
