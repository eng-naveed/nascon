import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, boot, call, Ctx, PASSWORD, uniq } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('day2web');
});
afterAll(async () => ctx.close());
beforeEach(async () => ctx.reset());

const get = (url: string) => ctx.app.inject({ method: 'GET', url });
const TESTIDS = [
  'guest-video-player', 'live-score-banner', 'pinned-merch-card', 'add-to-guest-cart-btn', 'guest-cart-count',
  'chat-message-list', 'chat-input-field', 'chat-send-btn', 'progressive-auth-modal',
];
const count = (html: string, id: string) => html.split(`data-testid="${id}"`).length - 1;
const tagOf = (html: string, id: string) => /<(\w+)[^>]*data-testid="/.exec(html.slice(html.lastIndexOf('<', html.indexOf(`data-testid="${id}"`))))![1];

describe('/web/matches/{id}/live (spec 6.2.2 contract)', () => {
  it('renders all nine data-testids exactly once, with the live score and no modal shown', async () => {
    const r = await get('/web/matches/match-m1/live');
    expect([r.statusCode, r.headers['content-type']]).toEqual([200, 'text/html; charset=utf-8']);
    for (const id of TESTIDS) expect(count(r.body, id), id).toBe(1);
    expect(r.body).toMatch(/data-testid="live-score-banner"[^>]*>1 - 0</);
    expect(r.body).toMatch(/data-testid="guest-cart-count"[^>]*>0</);
    expect(r.body).toMatch(/data-testid="progressive-auth-modal"[^>]*hidden>/);
    expect(r.body).toContain('data-variant-id="var-jersey-001-L"');
    expect(r.body).toContain('data-product-id="prod-jersey-001"');
    expect(r.body).toContain('PKR 4500.00');
    expect([tagOf(r.body, 'chat-input-field'), tagOf(r.body, 'chat-send-btn'), tagOf(r.body, 'add-to-guest-cart-btn'), tagOf(r.body, 'guest-cart-count')]).toEqual(['input', 'button', 'button', 'span']);
    expect(r.body).toContain('"hls":"/match/match-m1/index.m3u8"');
    expect(r.body).not.toMatch(/\son[a-z]+="/); // no inline handlers (CSP)
  });

  it('a11y basics: lang, labels, live regions, dialog semantics, security headers', async () => {
    const r = await get('/web/matches/match-m1/live');
    expect(r.body).toContain('<html lang="en">');
    expect(r.body).toMatch(/<video[^>]*aria-label="Live video: Alpha Lions vs Alpha Falcons"/);
    expect(r.body).toContain('<label for="chat-input">');
    expect(r.body).toMatch(/role="dialog" aria-modal="true" aria-labelledby="auth-h"/);
    expect(r.body).toMatch(/data-testid="chat-message-list"[^>]*role="log"/);
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('follows a re-pinned showcase item', async () => {
    await ctx.db.pool.query(`UPDATE matches SET showcase='{"variant_id":"var-merch-003-ONE"}' WHERE match_id='match-m1'`);
    const r = await get('/web/matches/match-m1/live');
    expect(r.body).toContain('data-variant-id="var-merch-003-ONE"');
    expect(r.body).toContain('League Training Cap');
  });

  it('QR scan lands on the live page (spec Test 1 path)', async () => {
    const q = await get('/q/m1-live');
    expect(q.headers.location).toBe('/web/matches/match-m1/live');
    expect((await get(q.headers.location as string)).statusCode).toBe(200);
  });
});

describe('/web/costream/{id}', () => {
  it('renders the nine testids, broadcasters and the composite HLS path', async () => {
    await call(ctx.app, 'POST', '/audit/v1/costream/session', { session_id: 'cs-session-101', host_player_id: 'player-alpha-1', participants: ['player-alpha-1', 'player-alpha-2'] });
    const r = await get('/web/costream/cs-session-101');
    expect(r.statusCode).toBe(200);
    for (const id of TESTIDS) expect(count(r.body, id), id).toBe(1);
    expect(r.body).toContain('LIVE - 2 on air');
    expect(r.body).toContain('<li class="host">player-alpha-1 (host)</li>');
    expect(r.body).toContain('"room":"chat-cs-session-101"');
    expect(r.body).toContain('"hls":"/costream/cs-session-101/index.m3u8"');
  });
  it('404 page for an unknown session', async () => {
    const r = await get('/web/costream/cs-session-404');
    expect([r.statusCode, r.headers['content-type']]).toEqual([404, 'text/html; charset=utf-8']);
  });
});

describe('other QR targets', () => {
  it('preview, vod and notice pages match the match state', async () => {
    const id = uniq('match');
    await call(ctx.app, 'POST', '/audit/v1/events', { event_id: uniq('e'), match_id: id, type: 'match_init', payload: { sport_id: 'football', home_team_id: 'club-alpha-3', away_team_id: 'club-alpha-4' } });
    expect((await get(`/web/matches/${id}/preview`)).body).toContain('Alpha Tigers vs Alpha Wolves');
    await call(ctx.app, 'POST', '/audit/v1/events', { event_id: uniq('e'), match_id: 'match-m1', type: 'match_end', payload: {} });
    const vod = await get('/web/matches/match-m1/vod');
    expect(vod.body).toMatch(/aria-label="Final score">1 - 0</);
    const n = await get('/web/matches/match-m1/notice?state=postponed');
    expect(n.body).toContain('has been <strong>postponed</strong>');
    expect((await get('/web/matches/match-m1/notice?state=%3Cscript%3E')).body).not.toContain('<script>alert');
  });
  it('player and club pages, and 404s', async () => {
    const p = await get('/web/players/player-alpha-1');
    expect([p.statusCode, p.body.includes('href="/web/clubs/club-alpha-1"')]).toEqual([200, true]);
    expect((await get('/web/clubs/club-alpha-1')).body).toContain('Lions Park, Islamabad');
    for (const u of ['/web/players/player-nope', '/web/clubs/club-nope', '/web/matches/match-nope/live', '/web/matches/match-m1/other', '/web/clubs/bad%20id'])
      expect((await get(u)).statusCode, u).toBe(404);
  });
  it('player page shows the FR-3.1 profile, follower count and a follow button behind the auth modal', async () => {
    const before = await get('/web/players/player-alpha-1');
    expect(before.body).toContain('id="follow-btn"');
    expect(before.body).toContain('0 followers');
    expect(before.body).toContain('Career record');
    expect(before.body).toContain('Upcoming fixtures');
    expect(before.body).toContain('Past streams');
    expect(count(before.body, 'progressive-auth-modal')).toBe(1);
    const tok = (await call(ctx.app, 'POST', '/api/v1/auth/login', { email: 'viewer@nascon.test', password: PASSWORD })).body.token;
    await call(ctx.app, 'POST', '/api/v1/players/player-alpha-1/follow', undefined, bearer(tok));
    expect((await get('/web/players/player-alpha-1')).body).toContain('1 follower<');
  });
  it('the index lists matches with links to their current view', async () => {
    const r = await get('/web');
    expect(r.body).toContain('href="/web/matches/match-m1/live"');
    expect(r.body).toContain('href="/web/matches/demo-m1/vod"');
  });
});

describe('assets', () => {
  it('serves the app script, stylesheet and vendored hls.js with correct types', async () => {
    const js = await get('/web/assets/app.js');
    expect([js.statusCode, js.headers['content-type']]).toEqual([200, 'text/javascript; charset=utf-8']);
    expect(js.body).toContain("'/api/v1/guest/session'");
    expect(() => new Function(js.body)).not.toThrow(); // syntactically valid
    const css = await get('/web/assets/app.css');
    expect([css.statusCode, css.headers['content-type']]).toEqual([200, 'text/css; charset=utf-8']);
    expect(css.body).toContain('min-height:48px');
    const h = await get('/web/assets/hls.js');
    expect(h.statusCode).toBe(200);
    expect(h.body.length).toBeGreaterThan(100_000);
  });
});
