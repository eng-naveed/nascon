import type { JwtClaims } from '../../core/crypto';

export type Role = 'super_admin' | 'league_organizer' | 'club_manager' | 'player' | 'viewer';

type Ent = { tenant_id: string; club_id: string | null } | null;
const sameTenant = (u: Pick<JwtClaims, 'tenant_id'>, e: { tenant_id: string }) => u.tenant_id === e.tenant_id;

/** Pure authorization matrix (spec 5.13). Authorization is decided before existence. */
export function decide(route: string, u: JwtClaims, id: string | undefined, e: Ent): 'allow' | 'deny' | 'missing' {
  const role = u.role as Role;
  const sa = role === 'super_admin';
  const finish = (ok: boolean) => (!sa && !ok ? 'deny' : e ? 'allow' : 'missing');
  switch (route) {
    case 'tenants':
    case 'platform-config':
      return sa ? 'allow' : 'deny';
    case 'league-fixtures':
      return finish(role === 'league_organizer' && !!e && sameTenant(u, e) && u.league_id === id);
    case 'club-roster':
    case 'club-products':
      return finish(role === 'club_manager' && !!e && sameTenant(u, e) && u.club_id === id);
    case 'player-patch':
      return finish(!!e && ((role === 'club_manager' && sameTenant(u, e) && e.club_id === u.club_id) || (role === 'player' && u.player_id === id)));
    case 'club-get':
      return finish(!!e && sameTenant(u, e));
    default:
      return 'deny';
  }
}

