import { z } from 'zod';
import type { PoolClient } from 'pg';
import { bodyHash } from '../../core/crypto';
import { conflict, notFound, validation } from '../../core/errors';
import { idSchema, parse } from '../../core/validate';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().startsWith(s), 'bad date');
const ROLES = ['captain', 'vice_captain', 'starter', 'substitute'] as const;

const setupSchema = z.object({
  league: z.object({
    league_id: idSchema,
    tenant_id: idSchema,
    sport_id: z.string().optional(),
    transfer_window: z.object({ open: date, close: date }),
    max_squad_size: z.number().int().min(1).optional(),
    required_positions: z.record(z.string(), z.number().int().min(0)).optional(),
  }),
  squads: z.array(z.object({ squad_id: idSchema, club_id: idSchema.optional(), tenant_id: idSchema, name: z.string().max(120).optional() })),
  players: z.array(z.object({ player_id: idSchema, name: z.string().max(120).optional(), position: z.string().max(40), squad_id: idSchema, role: z.enum(ROLES).optional() })),
  matches_in_progress: z.array(z.object({ match_id: idSchema, home_squad_id: idSchema, away_squad_id: idSchema })).optional(),
});

const transferSchema = z.object({
  request_id: idSchema,
  league_id: idSchema,
  player_id: idSchema,
  type: z.enum(['transfer', 'loan', 'release']),
  from_squad_id: idSchema,
  to_squad_id: idSchema.nullable().optional(),
  effective_date: date,
  loan_end_date: date.nullable().optional(),
  reason: z.string().max(500).optional(),
  requested_by: z.string().max(100).optional(),
});

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const today = () => new Date().toISOString().slice(0, 10);
const nextDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
type C = Pick<PoolClient, 'query'>;

export async function setupRoster(c: PoolClient, body: unknown) {
  const b = parse(setupSchema, body);
  const L = b.league;
  const sport = L.sport_id ? await c.query('SELECT config FROM sports WHERE sport_id=$1', [L.sport_id]) : null;
  const sportRoster = sport?.rowCount ? sport.rows[0].config.roster : null;
  const maxSquad = L.max_squad_size ?? sportRoster?.max_squad_size ?? 25;
  const required = L.required_positions ?? sportRoster?.required_positions ?? {};
  const squadIds = new Set(b.squads.map((s) => s.squad_id));
  for (const p of b.players) if (!squadIds.has(p.squad_id)) throw validation(['players']);
  if (new Set(b.players.map((p) => p.player_id)).size !== b.players.length) throw validation(['players']);
  if (new Set(b.squads.map((s) => s.squad_id)).size !== b.squads.length) throw validation(['squads']);

  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['roster:' + L.league_id]);
  await c.query('DELETE FROM roster_audit WHERE league_id=$1', [L.league_id]);
  await c.query('DELETE FROM roster_regs WHERE league_id=$1', [L.league_id]);
  await c.query('DELETE FROM roster_players WHERE league_id=$1', [L.league_id]);
  await c.query('DELETE FROM roster_squads WHERE league_id=$1', [L.league_id]);
  await c.query('DELETE FROM roster_leagues WHERE league_id=$1', [L.league_id]);
  await c.query('DELETE FROM roster_requests WHERE (response->>\'league_id\') IS NULL OR (response->\'registration\'->>\'league_id\')=$1 OR (response->\'audit_entry\'->>\'league_id\')=$1', [L.league_id]);
  await c.query('INSERT INTO roster_leagues VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    L.league_id, L.tenant_id, L.sport_id ?? null, L.transfer_window.open, L.transfer_window.close, maxSquad, JSON.stringify(required), JSON.stringify(b.matches_in_progress ?? []),
  ]);
  const counts: Record<string, number> = {};
  for (const s of b.squads) {
    await c.query('INSERT INTO roster_squads VALUES ($1,$2,$3,$4,$5)', [L.league_id, s.squad_id, s.club_id ?? null, s.tenant_id, s.name ?? s.squad_id]);
    counts[s.squad_id] = 0;
  }
  for (const p of b.players) {
    await c.query('DELETE FROM roster_regs WHERE player_id=$1', [p.player_id]);
    await c.query('INSERT INTO roster_players VALUES ($1,$2,$3,$4) ON CONFLICT (player_id) DO UPDATE SET league_id=$2, name=$3, position=$4', [p.player_id, L.league_id, p.name ?? p.player_id, p.position]);
    await c.query('INSERT INTO roster_regs(player_id, league_id, squad_id, role) VALUES ($1,$2,$3,$4)', [p.player_id, L.league_id, p.squad_id, p.role ?? 'substitute']);
    counts[p.squad_id]++;
  }
  return { league_id: L.league_id, status: 'configured', squad_counts: counts };
}

async function auditCount(c: C, playerId: string): Promise<number> {
  return Number((await c.query('SELECT count(*)::int AS n FROM roster_audit WHERE player_id=$1', [playerId])).rows[0].n);
}
export const rosterVersion = auditCount;

async function writeAudit(c: C, a: { player_id: string; league_id: string; action: string; from: string | null; to: string | null; eff: string; who: string; why: string; state: string }) {
  const r = await c.query(
    'INSERT INTO roster_audit(player_id, league_id, action, from_squad_id, to_squad_id, effective_date, who, "when", state, why) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING seq',
    [a.player_id, a.league_id, a.action, a.from, a.to, a.eff, a.who, nowIso(), a.state, a.why],
  );
  const audit_id = 'au-' + String(r.rows[0].seq).padStart(4, '0');
  await c.query('UPDATE roster_audit SET audit_id=$2 WHERE seq=$1', [r.rows[0].seq, audit_id]);
  return audit_id;
}

/** Materialises the automatic return of an expired loan (written once). */
async function materializeReturn(c: C, playerId: string, asOf: string) {
  const r = await c.query('SELECT * FROM roster_regs WHERE player_id=$1', [playerId]);
  const reg = r.rows[0];
  if (!reg || reg.reg_type !== 'loan' || !reg.loan_end_date || !(asOf > reg.loan_end_date)) return;
  const eff = nextDay(reg.loan_end_date);
  await writeAudit(c, { player_id: playerId, league_id: reg.league_id, action: 'loan_return', from: reg.squad_id, to: reg.parent_squad_id, eff, who: 'system', why: 'Loan ended', state: 'active' });
  await c.query("UPDATE roster_regs SET squad_id=parent_squad_id, role='substitute', reg_type=NULL, parent_squad_id=NULL, start_date=$2, loan_end_date=NULL WHERE player_id=$1", [playerId, eff]);
}

export async function transfer(c: PoolClient, rawBody: unknown): Promise<{ status: number; body: any }> {
  const b = parse(transferSchema, rawBody);
  if (b.type !== 'release' && !b.to_squad_id) throw validation(['to_squad_id']);
  if (b.type === 'loan' && (!b.loan_end_date || b.loan_end_date <= b.effective_date)) throw validation(['loan_end_date']);
  const hash = bodyHash(b);
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['roster:' + b.league_id]);
  const prev = await c.query('SELECT body_hash, response FROM roster_requests WHERE request_id=$1', [b.request_id]);
  if (prev.rowCount) return { status: 200, body: prev.rows[0].response };

  const lg = await c.query('SELECT * FROM roster_leagues WHERE league_id=$1', [b.league_id]);
  if (!lg.rowCount) throw notFound('LEAGUE_NOT_FOUND', `League ${b.league_id} not found.`, { league_id: b.league_id });
  const league = lg.rows[0];
  const pl = await c.query('SELECT * FROM roster_players WHERE player_id=$1', [b.player_id]);
  if (!pl.rowCount) throw notFound('PLAYER_NOT_FOUND', `Player ${b.player_id} not found.`, { player_id: b.player_id });
  const player = pl.rows[0];
  const sq = async (id: string) => {
    const r = await c.query('SELECT * FROM roster_squads WHERE league_id=$1 AND squad_id=$2', [b.league_id, id]);
    if (!r.rowCount) throw notFound('SQUAD_NOT_FOUND', `Squad ${id} not found.`, { squad_id: id });
    return r.rows[0];
  };
  const from = await sq(b.from_squad_id);
  const to = b.type === 'release' ? null : await sq(b.to_squad_id!);
  if (from.tenant_id !== league.tenant_id || (to && to.tenant_id !== league.tenant_id))
    throw conflict('CROSS_TENANT_TRANSFER', 'Squads must belong to the same tenant as the league.', { league_id: b.league_id });

  await materializeReturn(c, b.player_id, b.effective_date);
  const regRow = (await c.query('SELECT * FROM roster_regs WHERE player_id=$1', [b.player_id])).rows[0];
  if (!regRow || regRow.league_id !== b.league_id || regRow.squad_id !== b.from_squad_id)
    throw conflict('NOT_IN_SQUAD', `Player ${b.player_id} is not in squad ${b.from_squad_id}.`, { player_id: b.player_id, squad_id: b.from_squad_id });

  const moving = b.type !== 'release';
  if (moving && (b.effective_date < league.window_open || b.effective_date > league.window_close))
    throw conflict('TRANSFER_WINDOW_CLOSED', 'The transfer window is closed on that date.', { window: { open: league.window_open, close: league.window_close } });
  if (regRow.reg_type === 'loan') throw conflict('PLAYER_ON_LOAN', 'The player is currently on loan.', { player_id: b.player_id });
  if (moving) {
    const n = Number((await c.query('SELECT count(*)::int AS n FROM roster_regs WHERE league_id=$1 AND squad_id=$2', [b.league_id, b.to_squad_id])).rows[0].n);
    if (n + 1 > league.max_squad_size) throw conflict('SQUAD_FULL', 'The destination squad is full.', { squad_id: b.to_squad_id });
  }
  const minReq = league.required_positions?.[player.position];
  if (minReq !== undefined) {
    const n = Number(
      (await c.query('SELECT count(*)::int AS n FROM roster_regs g JOIN roster_players p ON p.player_id=g.player_id WHERE g.league_id=$1 AND g.squad_id=$2 AND p.position=$3', [b.league_id, b.from_squad_id, player.position])).rows[0].n,
    );
    if (n - 1 < minReq) throw conflict('MIN_POSITION_VIOLATION', `The squad would drop below the minimum for position ${player.position}.`, { position: player.position });
  }

  const blocking = (league.matches_in_progress as any[]).find((m) => m.home_squad_id === b.from_squad_id || m.away_squad_id === b.from_squad_id);
  const state = blocking ? 'deferred_until_match_end' : 'active';
  const reason = b.reason ?? '';
  const who = b.requested_by ?? 'unknown';
  let registration: any = null;
  if (b.type === 'release') {
    await c.query('UPDATE roster_regs SET squad_id=NULL, role=NULL, reg_type=NULL, parent_squad_id=NULL, start_date=NULL, loan_end_date=NULL WHERE player_id=$1', [b.player_id]);
  } else {
    const loan = b.type === 'loan';
    await c.query('UPDATE roster_regs SET squad_id=$2, role=$3, reg_type=$4, parent_squad_id=$5, start_date=$6, loan_end_date=$7 WHERE player_id=$1', [
      b.player_id, b.to_squad_id, 'substitute', b.type, loan ? b.from_squad_id : null, b.effective_date, loan ? b.loan_end_date : null,
    ]);
    registration = {
      player_id: b.player_id, league_id: b.league_id, squad_id: b.to_squad_id, parent_squad_id: loan ? b.from_squad_id : null,
      registration_type: b.type, start_date: b.effective_date, loan_end_date: loan ? b.loan_end_date : null, role: 'substitute',
    };
  }
  const audit_id = await writeAudit(c, { player_id: b.player_id, league_id: b.league_id, action: b.type, from: b.from_squad_id, to: b.to_squad_id ?? null, eff: b.effective_date, who, why: reason, state });
  const entry = (await c.query('SELECT * FROM roster_audit WHERE audit_id=$1', [audit_id])).rows[0];
  const response = {
    request_id: b.request_id, status: 'accepted', state, blocking_match_id: blocking ? blocking.match_id : null, registration,
    audit_entry: auditView(entry),
  };
  await c.query('INSERT INTO roster_requests VALUES ($1,$2,$3)', [b.request_id, hash, JSON.stringify(response)]);
  return { status: 201, body: response };
}

function auditView(e: any) {
  return {
    audit_id: e.audit_id, action: e.action, player_id: e.player_id, league_id: e.league_id, from_squad_id: e.from_squad_id, to_squad_id: e.to_squad_id,
    effective_date: e.effective_date, who: e.who, when: e.when, state: e.state, why: e.why,
  };
}

export async function history(c: PoolClient, playerId: string, asOfRaw: unknown) {
  const asOfSchema = date.optional();
  const asOf = parse(z.object({ as_of: asOfSchema }), { as_of: asOfRaw === '' ? undefined : asOfRaw }).as_of ?? today();
  const pl = await c.query('SELECT * FROM roster_players WHERE player_id=$1', [playerId]);
  if (!pl.rowCount) throw notFound('PLAYER_NOT_FOUND', `Player ${playerId} not found.`, { player_id: playerId });
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['roster:' + pl.rows[0].league_id]);
  await materializeReturn(c, playerId, asOf);
  const reg = (await c.query('SELECT * FROM roster_regs WHERE player_id=$1', [playerId])).rows[0];
  const rows = (await c.query('SELECT * FROM roster_audit WHERE player_id=$1 ORDER BY seq', [playerId])).rows;
  return { player_id: playerId, as_of: asOf, league_id: pl.rows[0].league_id, current_squad_id: reg?.squad_id ?? null, history: rows.map(auditView) };
}
