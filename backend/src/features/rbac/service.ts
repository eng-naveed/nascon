import { config } from '../../core/config';
import { JwtClaims, signJwt, verifyJwt } from '../../core/crypto';
import { pool } from '../../core/db';
import { AppError, forbidden, notFound, unauthenticated } from '../../core/errors';
import { decide } from './policy';

export const jwtSecret = () => 'nascon-jwt|' + config.salt;

export function authenticate(header: string | undefined): JwtClaims {
  if (!header || !/^Bearer\s+\S+$/i.test(header)) throw unauthenticated();
  const claims = verifyJwt(header.replace(/^Bearer\s+/i, ''), jwtSecret());
  if (!claims) throw unauthenticated();
  return claims;
}

export function mintToken(u: { user_id: string; role: string; tenant_id: string | null; league_id: string | null; club_id: string | null; player_id: string | null }) {
  return signJwt({ sub: u.user_id, role: u.role, tenant_id: u.tenant_id, league_id: u.league_id, club_id: u.club_id, player_id: u.player_id }, jwtSecret(), 24 * 3600);
}

export async function rbacMatrix() {
  const r = await pool.query("SELECT * FROM users WHERE user_id IN ('u-admin','u-organizer','u-manager','u-player','u-viewer')");
  const by = (role: string) => r.rows.find((x) => x.role === role);
  const tokens: Record<string, string> = {};
  for (const role of ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer']) tokens[role] = mintToken(by(role));
  return {
    tokens,
    context: {
      tenant_id: 'tenant-alpha', foreign_tenant_id: 'tenant-beta',
      own_league_id: 'league-alpha-1', other_league_id: 'league-alpha-2', foreign_league_id: 'league-beta-1',
      own_club_id: 'club-alpha-1', other_club_id: 'club-alpha-2', foreign_club_id: 'club-beta-1',
      own_player_id: 'player-alpha-1', other_player_id: 'player-alpha-2', foreign_player_id: 'player-beta-1',
    },
  };
}

async function entity(kind: string, id: string) {
  const r = await pool.query('SELECT tenant_id, club_id FROM rbac_entities WHERE kind=$1 AND id=$2', [kind, id]);
  return r.rowCount ? (r.rows[0] as { tenant_id: string; club_id: string | null }) : null;
}

const KIND: Record<string, string> = { 'league-fixtures': 'league', 'club-roster': 'club', 'club-products': 'club', 'player-patch': 'player', 'club-get': 'club' };

export async function probe(route: string, u: JwtClaims, id?: string): Promise<{ authorized: true }> {
  if (!(route in KIND) && route !== 'tenants' && route !== 'platform-config') throw new AppError(404, 'NOT_FOUND', 'Unknown probe.');
  const kind = KIND[route];
  const e = kind && id ? await entity(kind, id) : null;
  const d = decide(route, u, id, e);
  if (d === 'deny') throw forbidden();
  if (d === 'missing') throw notFound(`${kind.toUpperCase()}_NOT_FOUND`, `${kind} ${id} not found.`, { id });
  return { authorized: true };
}
