import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { api } from '@/api/client';
import type { League } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { Chips } from './Chips';
import { C } from '@/theme';

export function useLeagues() {
  const { session } = useApp();
  return useCached<League[]>(session ? 'leagues' : null, async () => (await api<{ leagues: League[] }>('/api/v1/leagues')).leagues ?? []);
}

export function LeaguePicker({ leagues }: { leagues: League[] }) {
  const { leagueId, setLeagueId } = useApp();
  useEffect(() => {
    if (leagues.length && !leagues.some((l) => l.league_id === leagueId)) setLeagueId(leagues[0].league_id);
  }, [leagues, leagueId, setLeagueId]);
  if (leagues.length <= 1) {
    return leagues[0] ? <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }} testID="league-name">{leagues[0].name}</Text> : null;
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: C.text }}>League</Text>
      <Chips testIDPrefix="league" value={leagueId} onChange={setLeagueId} options={leagues.map((l) => ({ value: l.league_id, label: l.name }))} />
    </View>
  );
}
