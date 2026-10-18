import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, boot, call, Ctx, PASSWORD, uniq } from './setup';

let ctx: Ctx;
const tok: Record<string, string> = {};
beforeAll(async () => {
  ctx = await boot('rosteradd');
  for (const who of ['admin', 'manager', 'player', 'viewer']) {
    const r = await call(ctx.app, 'POST', '/api/v1/auth/login', { email: `${who}@nascon.test`, password: PASSWORD });
    tok[who] = r.body.token;
  }
});
afterAll(async () => ctx.close());

const CLUB = 'club-alpha-1';
const add = (body: unknown, t?: string, club = CLUB) => call(ctx.app, 'POST', `/api/v1/roster/${club}/players`, body, t ? bearer(t) : {});

/** A league with one squad of the manager's club, holding one player, max size 2. */
async function scenario() {
  const p = uniq('ra');
  const squad = `${p}-sq`;
  const r = await call(ctx.app, 'POST', '/audit/v1/roster/setup', {
    league: { league_id: `${p}-lg`, tenant_id: 'tenant-alpha', transfer_window: { open: '2026-01-01', close: '2026-12-31' }, max_squad_size: 2 },
    squads: [{ squad_id: squad, club_id: CLUB, tenant_id: 'tenant-alpha', name: 'Add Test' }],
    players: [{ player_id: `${p}-p1`, name: 'Ali', position: 'gk', squad_id: squad }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { p, squad };
}

describe('POST /api/v1/roster/:club_id/players (FR-2.2)', () => {
  it('manager adds a player: 201 with audit entry, then visible in the roster', async () => {
    const { p, squad } = await scenario();
    const r = await add({ player_id: `${p}-new`, name: 'Bilal', position: 'df', squad_id: squad, role: 'starter' }, tok.manager);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.registration).toMatchObject({ player_id: `${p}-new`, squad_id: squad, role: 'starter', club_id: CLUB });
    expect(r.body.audit_entry).toMatchObject({ action: 'register', player_id: `${p}-new`, to_squad_id: squad, from_squad_id: null });
    const g = await call(ctx.app, 'GET', `/api/v1/roster/${CLUB}`, undefined, bearer(tok.manager));
    const sq = g.body.squads.find((s: any) => s.squad_id === squad);
    expect(sq.players.map((x: any) => x.player_id)).toContain(`${p}-new`);
  });

  it('duplicate player id → 409, full squad → 409, bad body → 400, foreign squad → 404', async () => {
    const { p, squad } = await scenario();
    const dup = await add({ player_id: `${p}-p1`, name: 'Again', position: 'gk', squad_id: squad }, tok.manager);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('PLAYER_ALREADY_REGISTERED');
    expect((await add({ player_id: `${p}-n2`, name: 'Two', position: 'mf', squad_id: squad }, tok.admin)).status).toBe(201);
    const full = await add({ player_id: `${p}-n3`, name: 'Three', position: 'fw', squad_id: squad }, tok.manager);
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('SQUAD_FULL');
    expect((await add({ player_id: `${p}-n4`, squad_id: squad }, tok.manager)).status).toBe(400);
    const nf = await add({ player_id: `${p}-n5`, name: 'X', position: 'fw', squad_id: 'sq-alpha-2' }, tok.manager);
    expect(nf.status).toBe(404);
    expect(nf.body.error.code).toBe('SQUAD_NOT_FOUND');
  });

  it('viewer, player and another club’s manager → 403; no token → 401', async () => {
    const { p, squad } = await scenario();
    const body = { player_id: `${p}-z`, name: 'Z', position: 'fw', squad_id: squad };
    expect((await add(body, tok.viewer)).status).toBe(403);
    expect((await add(body, tok.player)).status).toBe(403);
    expect((await add(body, tok.manager, 'club-alpha-2')).status).toBe(403);
    expect((await add(body)).status).toBe(401);
  });
});
