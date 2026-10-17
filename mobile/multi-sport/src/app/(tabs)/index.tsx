import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/api/client';
import type { Fixture } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { Screen, H } from '@/components/Screen';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { CacheNote } from '@/components/CacheNote';
import { StatusBadge } from '@/components/StatusBadge';
import { LeaguePicker, useLeagues } from '@/components/LeaguePicker';
import { C, fmtTime } from '@/theme';

export default function Fixtures() {
  const { leagueId } = useApp();
  const leagues = useLeagues();
  const fx = useCached<Fixture[]>(leagueId ? `fixtures:${leagueId}` : null, async () => (await api<{ fixtures: Fixture[] }>(`/api/v1/fixtures?league_id=${encodeURIComponent(leagueId!)}`)).fixtures ?? [], { pollMs: 5000 });
  const noLeagues = !leagues.loading && !leagues.error && (leagues.data?.length ?? 0) === 0;

  return (
    <Screen testID="screen-fixtures" loading={leagues.loading && !leagues.data} onRefresh={() => { leagues.reload(); fx.reload(); }}>
      <CacheNote fromCache={fx.fromCache || leagues.fromCache} updatedAt={fx.updatedAt ?? leagues.updatedAt} />
      {leagues.error && !leagues.data ? <ErrorBanner message={leagues.error} onRetry={leagues.reload} /> : null}
      {leagues.data ? <LeaguePicker leagues={leagues.data} /> : null}
      <H>Fixtures</H>
      {noLeagues ? <EmptyState title="No leagues yet" hint="Your organisation has no leagues set up." /> : null}
      {fx.loading && !fx.data && leagueId ? <Text style={{ color: C.sub, fontSize: 16 }} testID="loading-indicator">Loading matches…</Text> : null}
      {fx.error && !fx.data ? <ErrorBanner message={fx.error} onRetry={fx.reload} /> : null}
      {fx.data && fx.data.length === 0 ? <EmptyState title="No matches yet" hint="Fixtures will appear here once the schedule is published." icon="calendar-outline" /> : null}
      {(fx.data ?? []).map((f) => (
        <Card key={f.match_id} testID={`fixture-${f.match_id}`} label={`${f.home_name} versus ${f.away_name}, ${f.status}`} onPress={() => router.push({ pathname: '/match/[id]', params: { id: f.match_id, home: f.home_name, away: f.away_name } })}>
          <View style={s.top}>
            <StatusBadge status={f.status} />
            <Text style={s.time}>{fmtTime(f.scheduled_at)}</Text>
          </View>
          <View style={s.row}>
            <Text style={s.team} numberOfLines={2}>{f.home_name}</Text>
            <Text style={s.score}>{f.status === 'upcoming' ? 'vs' : `${f.home_score ?? 0} - ${f.away_score ?? 0}`}</Text>
            <Text style={[s.team, { textAlign: 'right' }]} numberOfLines={2}>{f.away_name}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
const s = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' },
  time: { fontSize: 14, color: C.sub },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  team: { flex: 1, fontSize: 16, fontWeight: '700', color: C.text },
  score: { fontSize: 22, fontWeight: '800', color: C.text, minWidth: 60, textAlign: 'center' },
});
