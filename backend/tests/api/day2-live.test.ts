import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, call, Ctx } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('day2live');
});
afterAll(async () => ctx?.close());
beforeEach(async () => ctx.reset());

const live = (id: string) => call(ctx.app, 'GET', `/api/v1/players/${id}/live`);
const key = (action: string) => call(ctx.app, 'POST', '/audit/v1/stream/key', { action, player_id: 'player-alpha-1' });

describe('GET /api/v1/players/{id}/live (FR-3.2 viewer discovery)', () => {
  it('is offline without an active key, live with one, offline again after revoke', async () => {
    expect((await live('player-alpha-1')).body).toEqual({
      athlete_id: 'player-alpha-1', live: false, label: null, started_at: null, hls_path: null, chat_room_id: 'chat-live-player-alpha-1',
    });
    const k = (await key('generate')).body.stream_key;
    const on = await live('player-alpha-1');
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ live: true, hls_path: `live/${k}`, chat_room_id: 'chat-live-player-alpha-1' });
    const k2 = (await key('rotate')).body.stream_key;
    expect((await live('player-alpha-1')).body.hls_path).toBe(`live/${k2}`);
    await key('revoke');
    expect((await live('player-alpha-1')).body).toMatchObject({ live: false, hls_path: null });
  });

  it('unknown player -> 404 PLAYER_NOT_FOUND', async () => {
    const r = await live('player-nope');
    expect([r.status, r.body.error.code]).toEqual([404, 'PLAYER_NOT_FOUND']);
  });
});
