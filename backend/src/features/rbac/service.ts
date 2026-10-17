import { config } from '../../core/config';
import { JwtClaims, signJwt, verifyJwt } from '../../core/crypto';
import { pool } from '../../core/db';
import { AppError, forbidden, notFound, unauthenticated } from '../../core/errors';

export const jwtSecret = () => 'nascon-jwt|' + config.salt;
export type Role = 'super_admin' | 'league_organizer' | 'club_manager' | 'player' | 'viewer';

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

const sameTenant = (u: JwtClaims, e: { tenant_id: string }) => u.tenant_id === e.tenant_id;

/** Evaluates a probe; authorization is decided before existence of the target. */
export async function probe(route: string, u: JwtClaims, id?: string): Promise<{ authorized: true }> {
  const role = u.role as Role;
  const sa = role === 'super_admin';
  const notFoundFor = (kind: string) => notFound(`${kind.toUpperCase()}_NOT_FOUND`, `${kind} ${id} not found.`, { id });
  switch (route) {
    case 'tenants':
    case 'platform-config':
      if (!sa) throw forbidden();
      return { authorized: true };
    case 'league-fixtures': {
      const e = await entity('league', id!);
      if (!sa && !(role === 'league_organizer' && e && sameTenant(u, e) && u.league_id === id)) throw forbidden();
      if (!e) throw notFoundFor('league');
      return { authorized: true };
    }
    case 'club-roster':
    case 'club-products': {
      const e = await entity('club', id!);
      if (!sa && !(role === 'club_manager' && e && sameTenant(u, e) && u.club_id === id)) throw forbidden();
      if (!e) throw notFoundFor('club');
      return { authorized: true };
    }
    case 'player-patch': {
      const e = await entity('player', id!);
      const ok = !!e && ((role === 'club_manager' && sameTenant(u, e) && e.club_id === u.club_id) || (role === 'player' && u.player_id === id));
      if (!sa && !ok) throw forbidden();
      if (!e) throw notFoundFor('player');
      return { authorized: true };
    }
    case 'club-get': {
      const e = await entity('club', id!);
      if (!sa && !(e && sameTenant(u, e))) throw forbidden();
      if (!e) throw notFoundFor('club');
      return { authorized: true };
    }
    default:
      throw new AppError(404, 'NOT_FOUND', 'Unknown probe.');
  }
}
