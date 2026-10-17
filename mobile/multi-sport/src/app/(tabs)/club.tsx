import React from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/api/client';
import type { Fixture } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { ClubProfile } from '@/features/club/ClubProfile';
import { Screen, H } from '@/components/Screen';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { LeaguePicker, useLeagues } from '@/components/LeaguePicker';
import { C } from '@/theme';

export default function ClubTab() {
  const { session, leagueId } = useApp();
  const leagues = useLeagues();
  const fx = useCached<Fixture[]>(leagueId ? `fixtures:${leagueId}` : null, async () => (await api<{ fixtures: Fixture[] }>(`/api/v1/fixtures?league_id=${encodeURIComponent(leagueId!)}`)).fixtures ?? []);
  if (session?.user.club_id) return <ClubProfile clubId={session.user.club_id} />;
  const teams = new Map<string, string>();
  (fx.data ?? []).forEach((f) => { teams.set(f.home_team_id, f.home_name); teams.set(f.away_team_id, f.away_name); });
  return (
    <Screen testID="screen-club-list" onRefresh={fx.reload}>
      {leagues.data ? <LeaguePicker leagues={leagues.data} /> : null}
      <H>Clubs</H>
      <Text style={{ color: C.sub, fontSize: 15 }}>Choose a club to see its profile, roster, staff and home venue.</Text>
      {teams.size === 0 ? <EmptyState title="No clubs yet" hint="Clubs appear once fixtures are published." icon="shield-outline" /> : null}
      {[...teams.entries()].map(([id, name]) => (
        <Card key={id} testID={`club-${id}`} label={`Open ${name}`} onPress={() => router.push({ pathname: '/club/[id]', params: { id, name } })}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.text }}>{name}</Text>
        </Card>
      ))}
    </Screen>
  );
}
