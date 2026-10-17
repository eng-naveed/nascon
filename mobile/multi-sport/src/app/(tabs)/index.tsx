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
import { TeamMark } from '@/components/TeamMark';
import { Skeleton, ScorePop } from '@/components/feedback';
import { C, F, fmtTime } from '@/theme';

export default function Fixtures() {
  const { leagueId } = useApp();
  const leagues = useLeagues();
  const fx = useCached<Fixture[]>(leagueId ? `fixtures:${leagueId}` : null, async () => (await api<{ fixtures: Fixture[] }>(`/api/v1/fixtures?league_id=${encodeURIComponent(leagueId!)}`)).fixtures ?? [], { pollMs: 5000 });
  const noLeagues = !leagues.loading && !leagues.error && (leagues.data?.length ?? 0) === 0;

  const all = fx.data ?? [];
  const live = all.filter((f) => f.status === 'in_progress');
  const rest = all.filter((f) => f.status !== 'in_progress');
  const renderCard = (f: Fixture) => (
    <Card key={f.match_id} testID={`fixture-${f.match_id}`} label={`${f.home_name} versus ${f.away_name}, ${f.status === 'in_progress' ? `live, score ${f.home_score ?? 0} to ${f.away_score ?? 0}` : f.status === 'completed' ? `final score ${f.home_score ?? 0} to ${f.away_score ?? 0}` : `upcoming, ${fmtTime(f.scheduled_at)}`}. Open match.`} onPress={() => router.push({ pathname: '/match/[id]', params: { id: f.match_id, home: f.home_name, away: f.away_name } })}>
      <View style={s.top}>
        <StatusBadge status={f.status} />
        <Text style={s.time}>{fmtTime(f.scheduled_at)}</Text>
      </View>
      <View style={s.row}>
        <View style={s.side}>
          <TeamMark id={f.home_team_id} name={f.home_name} />
          <Text style={s.team} numberOfLines={2}>{f.home_name}</Text>
        </View>
        <View style={s.mid}>
          <ScorePop style={[s.score, f.status === 'upcoming' && { fontSize: 24, color: C.sub }, f.status === 'in_progress' && { color: C.accent }]} value={f.status === 'upcoming' ? 'VS' : `${f.home_score ?? 0} - ${f.away_score ?? 0}`} />
        </View>
        <View style={s.side}>
          <TeamMark id={f.away_team_id} name={f.away_name} />
          <Text style={s.team} numberOfLines={2}>{f.away_name}</Text>
        </View>
      </View>
    </Card>
  );

  return (
    <Screen testID="screen-fixtures" loading={leagues.loading && !leagues.data} onRefresh={() => Promise.all([leagues.reload(), fx.reload()])}>
      <CacheNote fromCache={fx.fromCache || leagues.fromCache} updatedAt={fx.updatedAt ?? leagues.updatedAt} />
      {leagues.error && !leagues.data ? <ErrorBanner message={leagues.error} onRetry={leagues.reload} /> : null}
      {leagues.data ? <LeaguePicker leagues={leagues.data} /> : null}
      <H>Fixtures</H>
      {noLeagues ? <EmptyState title="No leagues yet" hint="Your organisation has no leagues set up." /> : null}
      {fx.loading && !fx.data && leagueId ? <Skeleton label="Loading matches" /> : null}
      {fx.error && !fx.data ? <ErrorBanner message={fx.error} onRetry={fx.reload} /> : null}
      {fx.data && fx.data.length === 0 ? <EmptyState title="No matches yet" hint="Fixtures will appear here once the schedule is published." icon="calendar-outline" /> : null}
      {live.length > 0 ? (
        <View style={s.liveHead} accessible accessibilityRole="header" accessibilityLabel={`Live now, ${live.length} ${live.length === 1 ? 'match' : 'matches'}`} testID="live-now-header">
          <View style={s.liveDot} />
          <Text style={s.liveT}>Live now</Text>
          <Text style={s.liveN}>{live.length}</Text>
        </View>
      ) : null}
      {live.map(renderCard)}
      {live.length > 0 && rest.length > 0 ? <Text style={s.restH} accessibilityRole="header">All matches</Text> : null}
      {rest.map(renderCard)}
    </Screen>
  );
}
const s = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' },
  time: { fontSize: 13, color: C.sub, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center' },
  side: { flex: 1, alignItems: 'center', gap: 8 },
  mid: { minWidth: 92, alignItems: 'center' },
  team: { fontSize: 15, fontWeight: '800', color: C.text, textAlign: 'center' },
  liveHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.live },
  liveT: { fontSize: 22, fontFamily: F.displayHeavy, color: C.text, letterSpacing: 0.6, textTransform: 'uppercase' },
  liveN: { fontSize: 13, fontWeight: '900', color: '#FFFFFF', backgroundColor: C.live, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  restH: { fontSize: 22, fontFamily: F.displayHeavy, color: C.text, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8 },
  score: { fontSize: 40, fontFamily: F.displayHeavy, color: C.text, textAlign: 'center', letterSpacing: 1 },
});
