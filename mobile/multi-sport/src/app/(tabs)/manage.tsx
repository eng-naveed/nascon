import React, { useState } from 'react';
import { View } from 'react-native';
import { useApp } from '@/state/app';
import { RosterManagement } from '@/features/roster/RosterManagement';
import { ScoringList } from '@/features/scoring/ScoringList';
import { EmptyState } from '@/components/EmptyState';
import { Chips } from '@/components/Chips';

export default function Manage() {
  const { session } = useApp();
  const [mode, setMode] = useState<'scoring' | 'roster'>('scoring');
  const role = session?.user.role;
  if (role === 'club_manager' && session?.user.club_id) return <RosterManagement clubId={session.user.club_id} />;
  if (role === 'league_organizer') return <ScoringList />;
  if (role === 'super_admin') {
    // The admin can do both scoring and roster work (one login is enough for the offline desk check).
    return (
      <View style={{ flex: 1 }}>
        <View style={{ padding: 12, paddingBottom: 0 }}>
          <Chips
            testIDPrefix="admin-mode"
            value={mode}
            onChange={(v) => setMode(v as 'scoring' | 'roster')}
            options={[{ value: 'scoring', label: 'Scoring' }, { value: 'roster', label: 'Roster (Alpha Lions)' }]}
          />
        </View>
        {mode === 'scoring' ? <ScoringList /> : <RosterManagement clubId="club-alpha-1" />}
      </View>
    );
  }
  return <EmptyState title="Nothing to manage" hint="This area is for club managers and league organizers." />;
}
