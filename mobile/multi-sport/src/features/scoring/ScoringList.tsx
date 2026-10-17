import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/api/client';
import type { Fixture } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { Screen, H } from '@/components/Screen';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { StatusBadge } from '@/components/StatusBadge';
import { LeaguePicker, useLeagues } from '@/components/LeaguePicker';
import { C } from '@/theme';

export function ScoringList() {
  const { leagueId } = useApp();
  const leagues = useLeagues();
  const fx = useCached<Fixture[]>(leagueId ? `fixtures:${leagueId}` : null, async () => (await api<{ fixtures: Fixture[] }>(`/api/v1/fixtures?league_id=${encodeURIComponent(leagueId!)}`)).fixtures ?? []);
  return (
    <Screen testID="screen-scoring-list" onRefresh={fx.reload}>
      {leagues.data ? <LeaguePicker leagues={leagues.data} /> : null}
      <H>Choose a match to score</H>
      {fx.error && !fx.data ? <ErrorBanner message={fx.error} onRetry={fx.reload} /> : null}
      {fx.data && fx.data.length === 0 ? <EmptyState title="No matches yet" /> : null}
      {(fx.data ?? []).map((f) => (
        <Card key={f.match_id} testID={`score-match-${f.match_id}`} label={`Score ${f.home_name} versus ${f.away_name}`} onPress={() => router.push({ pathname: '/scoring/[id]', params: { id: f.match_id, home: f.home_name, away: f.away_name } })}>
          <View style={{ gap: 6 }}>
            <StatusBadge status={f.status} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>{f.home_name} vs {f.away_name}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
