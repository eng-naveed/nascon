import React from 'react';
import { useApp } from '@/state/app';
import { RosterManagement } from '@/features/roster/RosterManagement';
import { ScoringList } from '@/features/scoring/ScoringList';
import { EmptyState } from '@/components/EmptyState';

export default function Manage() {
  const { session } = useApp();
  const role = session?.user.role;
  if (role === 'club_manager' && session?.user.club_id) return <RosterManagement clubId={session.user.club_id} />;
  if (role === 'league_organizer' || role === 'super_admin') return <ScoringList />;
  return <EmptyState title="Nothing to manage" hint="This area is for club managers and league organizers." />;
}
