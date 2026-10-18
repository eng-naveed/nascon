import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, boot, call, Ctx, PASSWORD, uniq } from './setup';

let ctx: Ctx;
const tok: Record<string, string> = {};
const ACCOUNTS = { admin: 'super_admin', organizer: 'league_organizer', manager: 'club_manager', player: 'player', viewer: 'viewer' } as const;

beforeAll(async () => {
  ctx = await boot('mobile');
});
afterAll(async () => ctx.close());

const get = (who: string, url: string) => call(ctx.app, 'GET', url, undefined, bearer(tok[who]));
const post = (who: string, url: string, body: unknown) => call(ctx.app, 'POST', url, body, bearer(tok[who]));

describe('POST /api/v1/auth/login', () => {
  it('logs in all 5 demo accounts', async () => {
    for (const [name, role] of Object.entries(ACCOUNTS)) {
      const r = await call(ctx.app, 'POST', '/api/v1/auth/login', { email: `${name.toUpperCase()}@nascon.test`, password: PASSWORD });
      expect(r.status, name).toBe(200);
      expect(r.body.user).toMatchObject({ email: `${name}@nascon.test`, role });
      tok[name] = r.body.token;
      if (role === 'super_admin') expect(r.body.tenant).toEqual({ id: null, name: 'NaSCon Platform', primary_color: '#14213D', logo_url: null });
      else expect(r.body.tenant).toMatchObject({ id: 'tenant-alpha', name: 'Alpha Sports', primary_color: '#0B5FFF' });
    }
    expect(ctx.crypto.verifyJwt(tok.player, 'nascon-jwt|test-salt')).toMatchObject({ sub: 'u-player', player_id: 'player-alpha-1', club_id: 'club-alpha-1' });
  });
  it('rejects bad credentials (401) and bad bodies (400)', async () => {
    const wrong = await call(ctx.app, 'POST', '/api/v1/auth/login', { email: 'admin@nascon.test', password: 'nope' });
    expect([wrong.status, wrong.body.error.code]).toEqual([401, 'UNAUTHENTICATED']);
    const unknown = await call(ctx.app, 'POST', '/api/v1/auth/login', { email: 'ghost@nascon.test', password: PASSWORD });
    expect(unknown.status).toBe(401);
    const bad = await call(ctx.app, 'POST', '/api/v1/auth/login', { email: 'a' });
    expect(bad.status).toBe(400);
  });
});

describe('authenticated /api/v1 routes', () => {
  it('every protected route requires a token', async () => {
    for (const [m, u] of [
      ['GET', '/api/v1/leagues'], ['GET', '/api/v1/sports'], ['GET', '/api/v1/fixtures'], ['GET', '/api/v1/matches/demo-m1'], ['GET', '/api/v1/standings/league-alpha-1'],
      ['GET', '/api/v1/clubs'], ['GET', '/api/v1/clubs/club-alpha-1'], ['GET', '/api/v1/store/products'], ['POST', '/api/v1/checkout'], ['POST', '/api/v1/events'],
      ['POST', '/api/v1/roster/transfer'], ['GET', '/api/v1/roster/history/player-alpha-1'], ['GET', '/api/v1/roster/club-alpha-1'], ['POST', '/api/v1/offline-sync'],
      ['POST', '/api/v1/matches/demo-m1/showcase'],
    ]) {
      const r = await call(ctx.app, m, u, m === 'POST' ? {} : undefined);
      expect(r.status, u).toBe(401);
    }
  });

  it('leagues / sports / fixtures / clubs / products are tenant-scoped', async () => {
    const l = await get('viewer', '/api/v1/leagues');
    expect(l.body.leagues).toEqual([{ league_id: 'league-alpha-1', name: 'Alpha Premier League', sport_id: 'football', tenant_id: 'tenant-alpha', team_count: 4, qualification_spots: 2 }]);
    const s = await get('viewer', '/api/v1/sports');
    expect(s.body.sports.map((x: any) => x.sport_id).sort()).toEqual(['basketball', 'cricket', 'esports', 'football']);
    const f = await get('viewer', '/api/v1/fixtures');
    expect(f.body.fixtures).toHaveLength(7);
    expect(f.body.fixtures[0]).toMatchObject({ match_id: 'demo-m1', home_name: 'Alpha Lions', away_name: 'Alpha Falcons', status: 'completed', home_score: 2, away_score: 1, version: 5 });
    const byLeague = await get('admin', '/api/v1/fixtures?league_id=league-alpha-1');
    expect(byLeague.body.fixtures).toHaveLength(7);
    const none = await get('organizer', '/api/v1/fixtures?league_id=nope');
    expect(none.body.fixtures).toEqual([]);
    const clubs = await get('viewer', '/api/v1/clubs');
    expect(clubs.body.clubs.map((c: any) => c.club_id)).not.toContain('club-beta-1');
    const allClubs = await get('admin', '/api/v1/clubs');
    expect(allClubs.body.clubs.map((c: any) => c.club_id)).toContain('club-beta-1');
    const p = await get('player', '/api/v1/store/products');
    expect(p.body.products[0]).toMatchObject({ product_id: 'prod-jersey-001', variants: [{ variant_id: 'var-jersey-001-L', currency: 'PKR' }, { variant_id: 'var-jersey-001-M' }] });
  });

  it('matches/:id with names, showcase pinning and role checks', async () => {
    const m = await get('viewer', '/api/v1/matches/demo-m3');
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ match_id: 'demo-m3', status: 'in_progress', home: { name: 'Alpha Lions', score: 1 }, away: { name: 'Alpha Tigers' }, showcase: null });
    const nf = await get('viewer', '/api/v1/matches/ghost');
    expect([nf.status, nf.body.error.code]).toEqual([404, 'MATCH_NOT_FOUND']);
    const denied = await post('viewer', '/api/v1/matches/demo-m3/showcase', { variant_id: 'var-jersey-001-M' });
    expect(denied.status).toBe(403);
    const badVar = await post('organizer', '/api/v1/matches/demo-m3/showcase', { variant_id: 'nope' });
    expect([badVar.status, badVar.body.error.code]).toEqual([404, 'VARIANT_NOT_FOUND']);
    const badMatch = await post('admin', '/api/v1/matches/ghost/showcase', { variant_id: 'var-jersey-001-M' });
    expect([badMatch.status, badMatch.body.error.code]).toEqual([404, 'MATCH_NOT_FOUND']);
    const invalid = await post('admin', '/api/v1/matches/demo-m3/showcase', {});
    expect(invalid.status).toBe(400);
    const ok = await post('organizer', '/api/v1/matches/demo-m3/showcase', { variant_id: 'var-jersey-001-M' });
    expect(ok.body).toEqual({ status: 'pinned' });
    const after = await get('viewer', '/api/v1/matches/demo-m3');
    expect(after.body.showcase).toEqual({ variant_id: 'var-jersey-001-M', product_name: 'Alpha Lions Home Jersey', price_minor: 450000 });
    // a match whose teams are not clubs falls back to team ids
    const id = uniq('mm');
    await call(ctx.app, 'POST', '/audit/v1/events', { event_id: uniq('e'), match_id: id, type: 'match_init', payload: { sport_id: 'football', home_team_id: 'tx', away_team_id: 'ty' } });
    expect((await get('viewer', `/api/v1/matches/${id}`)).body).toMatchObject({ home: { name: 'tx' }, away: { name: 'ty' } });
  });

  it('standings and club views', async () => {
    const s = await get('viewer', '/api/v1/standings/league-alpha-1');
    expect(s.body.table).toHaveLength(4);
    const own = await get('player', '/api/v1/clubs/club-alpha-1');
    expect(own.body).toMatchObject({ club_id: 'club-alpha-1', name: 'Alpha Lions', home_venue: { name: 'Lions Park, Islamabad' } });
    expect(own.body.roster).toHaveLength(6);
    const foreign = await get('viewer', '/api/v1/clubs/club-beta-1');
    expect(foreign.status).toBe(403);
    expect((await get('admin', '/api/v1/clubs/club-beta-1')).status).toBe(200);
    const nf = await get('admin', '/api/v1/clubs/ghost');
    expect([nf.status, nf.body.error.code]).toEqual([404, 'CLUB_NOT_FOUND']);
  });

  it('roster views and transfer role checks', async () => {
    const r = await get('manager', '/api/v1/roster/club-alpha-1');
    expect(r.body).toMatchObject({ club_id: 'club-alpha-1', league_id: 'roster-alpha-1', transfer_window: { open: '2026-01-01', close: '2026-12-31' }, other_squads: [{ squad_id: 'sq-alpha-2' }] });
    expect(r.body.squads[0].players).toHaveLength(6);
    const empty = await get('manager', '/api/v1/roster/club-alpha-4');
    expect(empty.body).toEqual({ club_id: 'club-alpha-4', other_squads: [], league_id: null, transfer_window: null, squads: [] });
    const body = { request_id: uniq('mr'), league_id: 'roster-alpha-1', player_id: 'demo-p1-5', type: 'transfer', from_squad_id: 'sq-alpha-1', to_squad_id: 'sq-alpha-2', effective_date: '2026-06-01' };
    for (const who of ['player', 'viewer', 'organizer']) expect((await post(who, '/api/v1/roster/transfer', body)).status, who).toBe(403);
    const ok = await post('manager', '/api/v1/roster/transfer', body);
    expect(ok.status).toBe(201);
    const h = await get('viewer', '/api/v1/roster/history/demo-p1-5?as_of=2026-06-02');
    expect(h.body).toMatchObject({ current_squad_id: 'sq-alpha-2', history: [{ action: 'transfer' }] });
  });

  it('events and checkout through /api/v1', async () => {
    const m = uniq('me');
    const ev = { event_id: uniq('e'), match_id: m, type: 'match_init', payload: { sport_id: 'esports', home_team_id: 'club-alpha-1', away_team_id: 'club-alpha-2' } };
    for (const who of ['viewer', 'player', 'manager']) expect((await post(who, '/api/v1/events', ev)).status, who).toBe(403);
    expect((await post('organizer', '/api/v1/events', ev)).status).toBe(201);
    expect((await post('admin', '/api/v1/events', { event_id: uniq('e'), match_id: m, type: 'match_start' })).status).toBe(201);
    const co = await post('player', '/api/v1/checkout', {
      order_id: uniq('mo'), customer_id: 'u-player', items: [{ variant_id: 'var-jersey-001-L', quantity: 1 }], discount_code: 'WELCOME10', payment: { token: 'tok_success' },
    });
    expect(co.status).toBe(201);
    expect(co.body.total_minor).toBe(405000);
  });

  it('offline sync through /api/v1', async () => {
    const r = await post('viewer', '/api/v1/offline-sync', {
      device_id: uniq('dev'),
      actions: [{ action_id: 'x1', type: 'score_event', queued_at: '2026-10-17T10:00:00Z', base_version: 5, payload: { event_id: uniq('e'), match_id: 'demo-m1', type: 'match_start' } }],
    });
    expect(r.status).toBe(200);
    expect(r.body.results[0]).toMatchObject({ status: 'rejected', error_code: 'ILLEGAL_TRANSITION', server_version: 5 });
  });
});
