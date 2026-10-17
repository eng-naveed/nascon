import { conflict } from '../../core/errors';

export interface TransferRuleCtx {
  type: 'transfer' | 'loan' | 'release';
  leagueTenant: string;
  fromTenant: string;
  toTenant: string | null;
  currentSquad: string | null;
  fromSquadId: string;
  leagueMatches: boolean;
  regType: string | null;
  effectiveDate: string;
  windowOpen: string;
  windowClose: string;
  destCount: number;
  maxSquad: number;
  position: string;
  positionCountInFrom: number;
  requiredMin: number | undefined;
  playerId: string;
  toSquadId: string | null;
}

/** Spec 5.11 rules 3..8, evaluated in the contract's exact order. Throws the first failure. */
export function checkTransferRules(c: TransferRuleCtx): void {
  if (c.fromTenant !== c.leagueTenant || (c.toTenant !== null && c.toTenant !== c.leagueTenant))
    throw conflict('CROSS_TENANT_TRANSFER', 'Squads must belong to the same tenant as the league.', {});
  if (!c.leagueMatches || c.currentSquad !== c.fromSquadId)
    throw conflict('NOT_IN_SQUAD', `Player ${c.playerId} is not in squad ${c.fromSquadId}.`, { player_id: c.playerId, squad_id: c.fromSquadId });
  const moving = c.type !== 'release';
  if (moving && (c.effectiveDate < c.windowOpen || c.effectiveDate > c.windowClose))
    throw conflict('TRANSFER_WINDOW_CLOSED', 'The transfer window is closed on that date.', { window: { open: c.windowOpen, close: c.windowClose } });
  if (c.regType === 'loan') throw conflict('PLAYER_ON_LOAN', 'The player is currently on loan.', { player_id: c.playerId });
  if (moving && c.destCount + 1 > c.maxSquad) throw conflict('SQUAD_FULL', 'The destination squad is full.', { squad_id: c.toSquadId });
  if (c.requiredMin !== undefined && c.positionCountInFrom - 1 < c.requiredMin)
    throw conflict('MIN_POSITION_VIOLATION', `The squad would drop below the minimum for position ${c.position}.`, { position: c.position });
}
