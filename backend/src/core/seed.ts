import type { PoolClient } from 'pg';
import { hashPassword } from './crypto';
import { BASELINE_SPORTS } from '../features/sports/service';
import { appendEvent } from '../features/events/service';
import { createLeague } from '../features/standings/service';
import { setupRoster } from '../features/roster/service';

const TABLES = [
  'kv', 'tenants', 'users', 'rbac_entities', 'clubs', 'sports', 'leagues', 'matches', 'events', 'products', 'variants', 'orders',
  'queue_events', 'roster_leagues', 'roster_squads', 'roster_players', 'roster_regs', 'roster_audit', 'roster_requests', 'sync_actions',
];

let pwHash: string | null = null;

export interface ResetOpts {
  seed?: number;
  stock?: Record<string, number>;
}

export async function resetAndSeed(c: PoolClient, opts: ResetOpts = {}) {
  const seed = opts.seed ?? 42;
  await c.query('SELECT pg_advisory_xact_lock(7777)');
  await c.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`);
  await c.query("INSERT INTO kv VALUES ('seed', $1)", [JSON.stringify(seed)]);
  await c.query("INSERT INTO tenants VALUES ('tenant-alpha','Alpha Sports','#0B5FFF',NULL), ('tenant-beta','Beta Athletics','#B4231F',NULL)");

  pwHash = pwHash ?? hashPassword('Nascon@26');
  const users = [
    ['u-admin', 'admin@nascon.test', 'Platform Admin', 'super_admin', null, null, null, null],
    ['u-organizer', 'organizer@nascon.test', 'League Organizer', 'league_organizer', 'tenant-alpha', 'league-alpha-1', null, null],
    ['u-manager', 'manager@nascon.test', 'Club Manager', 'club_manager', 'tenant-alpha', null, 'club-alpha-1', null],
    ['u-player', 'player@nascon.test', 'Ali Khan', 'player', 'tenant-alpha', null, 'club-alpha-1', 'player-alpha-1'],
    ['u-viewer', 'viewer@nascon.test', 'General Viewer', 'viewer', 'tenant-alpha', null, null, null],
  ];
  for (const u of users) await c.query('INSERT INTO users VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [u[0], u[1], u[2], u[3], pwHash, u[4], u[5], u[6], u[7]]);

  const ent: [string, string, string, string | null][] = [
    ['league', 'league-alpha-1', 'tenant-alpha', null], ['league', 'league-alpha-2', 'tenant-alpha', null], ['league', 'league-beta-1', 'tenant-beta', null],
    ['club', 'club-alpha-1', 'tenant-alpha', null], ['club', 'club-alpha-2', 'tenant-alpha', null], ['club', 'club-beta-1', 'tenant-beta', null],
    ['club', 'club-alpha-3', 'tenant-alpha', null], ['club', 'club-alpha-4', 'tenant-alpha', null],
    ['player', 'player-alpha-1', 'tenant-alpha', 'club-alpha-1'], ['player', 'player-alpha-2', 'tenant-alpha', 'club-alpha-2'], ['player', 'player-beta-1', 'tenant-beta', 'club-beta-1'],
  ];
  for (const e of ent) await c.query('INSERT INTO rbac_entities VALUES ($1,$2,$3,$4)', e);

  const clubs: [string, string, string, number, number, string][] = [
    ['club-alpha-1', 'tenant-alpha', 'Alpha Lions', 33.6844, 73.0479, 'Lions Park, Islamabad'],
    ['club-alpha-2', 'tenant-alpha', 'Alpha Falcons', 33.7294, 73.0931, 'Falcon Ground, Islamabad'],
    ['club-alpha-3', 'tenant-alpha', 'Alpha Tigers', 33.6007, 73.0679, 'Tiger Arena, Rawalpindi'],
    ['club-alpha-4', 'tenant-alpha', 'Alpha Wolves', 33.7077, 73.0501, 'Wolf Den, Islamabad'],
    ['club-beta-1', 'tenant-beta', 'Beta Bulls', 31.5204, 74.3587, 'Bull Stadium, Lahore'],
  ];
  for (const [id, t, name, lat, lng, venue] of clubs)
    await c.query('INSERT INTO clubs VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      id, t, name, JSON.stringify({ name: venue, lat, lng }), JSON.stringify({ twitter: '@' + id.replace(/-/g, ''), instagram: id.replace(/-/g, '_') }),
      JSON.stringify([{ name: 'Head Coach', role: 'coach' }, { name: 'Club Manager', role: 'manager' }, { name: 'Team Physio', role: 'physio' }]),
      JSON.stringify([{ season: '2025', played: 20, won: 11, drawn: 5, lost: 4 }, { season: '2024', played: 20, won: 8, drawn: 6, lost: 6 }]),
    ]);

  for (const s of BASELINE_SPORTS) await c.query('INSERT INTO sports(sport_id, config) VALUES ($1,$2)', [s.sport_id, JSON.stringify(s)]);

  await c.query("INSERT INTO products VALUES ('prod-jersey-001','tenant-alpha','Alpha Lions Home Jersey','Official replica home jersey, 2026 season')");
  const stock = { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5, ...(opts.stock ?? {}) } as Record<string, number>;
  await c.query("INSERT INTO variants VALUES ('var-jersey-001-M','prod-jersey-001','Size M',450000,'PKR',$1,0), ('var-jersey-001-L','prod-jersey-001','Size L',450000,'PKR',$2,0)", [
    stock['var-jersey-001-M'], stock['var-jersey-001-L'],
  ]);
  const finalStock = { 'var-jersey-001-M': stock['var-jersey-001-M'], 'var-jersey-001-L': stock['var-jersey-001-L'] };

  await seedDemo(c);
  return {
    status: 'reset_complete', seed, sports: BASELINE_SPORTS.map((s) => s.sport_id), tenants: ['tenant-alpha', 'tenant-beta'], stock: finalStock,
  };
}

/** Demo data so the mobile app has real content (league, fixtures, completed matches, squads). */
async function seedDemo(c: PoolClient) {
  const teams = ['club-alpha-1', 'club-alpha-2', 'club-alpha-3', 'club-alpha-4'];
  const pairs: [number, number][] = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
  const day = (n: number) => `2026-10-${String(10 + n).padStart(2, '0')}T15:00:00Z`;
  await createLeague(c, {
    league_id: 'league-alpha-1', sport_id: 'football', name: 'Alpha Premier League', tenant_id: 'tenant-alpha', teams,
    fixtures: pairs.map(([h, a], i) => ({ match_id: `demo-m${i + 1}`, home: teams[h], away: teams[a], scheduled_at: day(i) })),
    qualification: { spots: 2 },
  });
  let n = 0;
  const ev = async (match: string, type: string, payload: any = {}) => appendEvent(c, { event_id: `demo-e${++n}`, match_id: match, type, payload });
  await ev('demo-m1', 'match_start');
  for (const t of ['club-alpha-1', 'club-alpha-1', 'club-alpha-2']) await ev('demo-m1', 'score', { team_id: t, event_type: 'goal' });
  await ev('demo-m1', 'match_end');
  await ev('demo-m2', 'match_start');
  for (const t of ['club-alpha-3', 'club-alpha-4']) await ev('demo-m2', 'score', { team_id: t, event_type: 'goal' });
  await ev('demo-m2', 'match_end');
  await ev('demo-m3', 'match_start');
  await ev('demo-m3', 'score', { team_id: 'club-alpha-1', event_type: 'goal' });

  const pos = ['gk', 'df', 'df', 'mf', 'mf', 'fw'];
  const players: any[] = [];
  for (const [si, club] of [[1, 'club-alpha-1'], [2, 'club-alpha-2']] as const)
    pos.forEach((p, i) =>
      players.push({
        player_id: i === 0 && si <= 2 ? `player-alpha-${si}` : `demo-p${si}-${i}`, name: `${club === 'club-alpha-1' ? 'Lions' : 'Falcons'} Player ${i + 1}`,
        position: p, squad_id: `sq-alpha-${si}`, role: i === 0 ? 'captain' : 'starter',
      }),
    );
  await setupRoster(c, {
    league: { league_id: 'roster-alpha-1', tenant_id: 'tenant-alpha', sport_id: 'football', transfer_window: { open: '2026-01-01', close: '2026-12-31' } },
    squads: [
      { squad_id: 'sq-alpha-1', club_id: 'club-alpha-1', tenant_id: 'tenant-alpha', name: 'Alpha Lions First Team' },
      { squad_id: 'sq-alpha-2', club_id: 'club-alpha-2', tenant_id: 'tenant-alpha', name: 'Alpha Falcons First Team' },
    ],
    players,
  });
}
