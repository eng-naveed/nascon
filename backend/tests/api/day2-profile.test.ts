import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, call, Ctx } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('day2profile');
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const profile = (id: string) => call(ctx.app, 'GET', `/api/v1/players/${id}/profile`);

describe('GET /api/v1/players/:id/profile (FR-3.1)', () => {
  it('returns the aggregated profile shape for a seeded player', async () => {
    const r = await profile('player-alpha-1');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ player_id: 'player-alpha-1', club_id: 'club-alpha-1', vod_archive: [] });
    expect(r.body.active_clubs).toContain('club-alpha-1');
    expect(Object.keys(r.body.career)).toEqual(['matches_played', 'wins', 'draws', 'losses', 'goals_or_points']);
    expect(r.body.career.matches_played).toBe(r.body.career.wins + r.body.career.draws + r.body.career.losses);
    expect(Array.isArray(r.body.upcoming_fixtures)).toBe(true);
  });

  it('is 404 PLAYER_NOT_FOUND for an unknown player', async () => {
    const r = await profile('player-nope-9');
    expect([r.status, r.body.error.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
  });

  it('lists a retired stream key in the VOD archive after rotate + revoke', async () => {
    await call(ctx.app, 'POST', '/audit/v1/stream/key', { action: 'rotate', player_id: 'player-alpha-1', label: 'OBS-Main-Desk' });
    await call(ctx.app, 'POST', '/audit/v1/stream/key', { action: 'revoke', player_id: 'player-alpha-1' });
    const r = await profile('player-alpha-1');
    expect(r.body.vod_archive[0]).toMatchObject({ stream_key_label: 'OBS-Main-Desk', playback_url: null });
    expect(r.body.vod_archive[0].ended_at).toBeTruthy();
  });
});
