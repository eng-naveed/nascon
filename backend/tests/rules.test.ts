import { describe, expect, it } from 'vitest';
import { checkTransferRules, TransferRuleCtx } from '../src/features/roster/rules';
import { decide } from '../src/features/rbac/policy';

const base: TransferRuleCtx = {
  type: 'transfer', leagueTenant: 't', fromTenant: 't', toTenant: 't', currentSquad: 'a', fromSquadId: 'a', leagueMatches: true, regType: null,
  effectiveDate: '2026-09-30', windowOpen: '2026-09-01', windowClose: '2026-09-30', destCount: 1, maxSquad: 3, position: 'df', positionCountInFrom: 2,
  requiredMin: undefined, playerId: 'p', toSquadId: 'b',
};
const code = (o: Partial<TransferRuleCtx>) => {
  try {
    checkTransferRules({ ...base, ...o });
    return 'ok';
  } catch (e: any) {
    return e.code;
  }
};

describe('roster rules (evaluated in contract order)', () => {
  it('accepts a valid transfer, window edges are inclusive', () => {
    expect(code({})).toBe('ok');
    expect(code({ effectiveDate: '2026-09-01' })).toBe('ok');
  });
  it('each rule maps to its error code', () => {
    expect(code({ toTenant: 'x' })).toBe('CROSS_TENANT_TRANSFER');
    expect(code({ currentSquad: 'zz' })).toBe('NOT_IN_SQUAD');
    expect(code({ leagueMatches: false })).toBe('NOT_IN_SQUAD');
    expect(code({ effectiveDate: '2026-10-01' })).toBe('TRANSFER_WINDOW_CLOSED');
    expect(code({ effectiveDate: '2026-08-31', type: 'loan' })).toBe('TRANSFER_WINDOW_CLOSED');
    expect(code({ regType: 'loan' })).toBe('PLAYER_ON_LOAN');
    expect(code({ destCount: 3 })).toBe('SQUAD_FULL');
    expect(code({ requiredMin: 2 })).toBe('MIN_POSITION_VIOLATION');
  });
  it('release ignores window and squad size but still checks position minimum', () => {
    expect(code({ type: 'release', effectiveDate: '2027-01-01', destCount: 99, toTenant: null, toSquadId: null })).toBe('ok');
    expect(code({ type: 'release', toTenant: null, requiredMin: 2 })).toBe('MIN_POSITION_VIOLATION');
  });
  it('first failure wins', () => {
    expect(code({ toTenant: 'x', currentSquad: 'zz', regType: 'loan', destCount: 9 })).toBe('CROSS_TENANT_TRANSFER');
    expect(code({ effectiveDate: '2030-01-01', regType: 'loan' })).toBe('TRANSFER_WINDOW_CLOSED');
  });
});

const user = (role: string, extra: any = {}) => ({ sub: 'u', role, tenant_id: 'tenant-alpha', league_id: null, club_id: null, player_id: null, iat: 0, exp: 0, ...extra });
const ent = (tenant: string, club: string | null = null) => ({ tenant_id: tenant, club_id: club });

describe('rbac decision matrix', () => {
  const roles = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'];
  const u = (r: string) => user(r, { league_id: 'league-alpha-1', club_id: 'club-alpha-1', player_id: 'player-alpha-1' });
  const row = (route: string, id: string, e: any) => roles.map((r) => decide(route, u(r), id, e)).map((d) => (d === 'allow' ? 'A' : 'D')).join('');
  it('platform routes are super-admin only', () => {
    expect(row('tenants', '', null)).toBe('ADDDD');
    expect(row('platform-config', '', null)).toBe('ADDDD');
  });
  it('league fixtures', () => {
    expect(row('league-fixtures', 'league-alpha-1', ent('tenant-alpha'))).toBe('AADDD');
    expect(row('league-fixtures', 'league-alpha-2', ent('tenant-alpha'))).toBe('ADDDD');
    expect(row('league-fixtures', 'league-beta-1', ent('tenant-beta'))).toBe('ADDDD');
  });
  it('club roster and products', () => {
    expect(row('club-roster', 'club-alpha-1', ent('tenant-alpha'))).toBe('ADADD');
    expect(row('club-products', 'club-alpha-2', ent('tenant-alpha'))).toBe('ADDDD');
    expect(row('club-roster', 'club-beta-1', ent('tenant-beta'))).toBe('ADDDD');
  });
  it('player patch', () => {
    expect(row('player-patch', 'player-alpha-1', ent('tenant-alpha', 'club-alpha-1'))).toBe('ADAAD');
    expect(row('player-patch', 'player-alpha-2', ent('tenant-alpha', 'club-alpha-2'))).toBe('ADDDD');
    expect(row('player-patch', 'player-beta-1', ent('tenant-beta', 'club-beta-1'))).toBe('ADDDD');
  });
  it('club get is readable inside the tenant', () => {
    expect(row('club-get', 'club-alpha-2', ent('tenant-alpha'))).toBe('AAAAA');
    expect(row('club-get', 'club-beta-1', ent('tenant-beta'))).toBe('ADDDD');
  });
  it('missing ids: super admin gets 404, others 403', () => {
    expect(decide('club-get', u('super_admin'), 'x', null)).toBe('missing');
    expect(decide('club-get', u('viewer'), 'x', null)).toBe('deny');
    expect(decide('unknown', u('super_admin'), 'x', null)).toBe('deny');
  });
});
