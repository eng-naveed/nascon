import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/api/client';
import type { Fixture, Standings, StandingRow } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { Screen, H } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { CacheNote } from '@/components/CacheNote';
import { LeaguePicker, useLeagues } from '@/components/LeaguePicker';
import { C } from '@/theme';

function QBadge({ status }: { status: StandingRow['status'] }) {
  if (status === 'clinched') return <Badge kind="ok" icon="checkmark-circle" text="Clinched" />;
  if (status === 'eliminated') return <Badge kind="bad" icon="close-circle" text="Eliminated" />;
  return <Badge kind="warn" icon="help-circle" text="Still possible" />;
}

export default function StandingsScreen() {
  const { leagueId } = useApp();
  const leagues = useLeagues();
  const st = useCached<Standings>(leagueId ? `standings:${leagueId}` : null, () => api<Standings>(`/api/v1/standings/${encodeURIComponent(leagueId!)}`), { pollMs: 10000 });
  const fx = useCached<Fixture[]>(leagueId ? `fixtures:${leagueId}` : null, async () => (await api<{ fixtures: Fixture[] }>(`/api/v1/fixtures?league_id=${encodeURIComponent(leagueId!)}`)).fixtures ?? []);
  const names = new Map<string, string>();
  (fx.data ?? []).forEach((f) => { names.set(f.home_team_id, f.home_name); names.set(f.away_team_id, f.away_name); });

  return (
    <Screen testID="screen-standings" loading={leagues.loading && !leagues.data} onRefresh={() => { st.reload(); fx.reload(); }}>
      <CacheNote fromCache={st.fromCache} updatedAt={st.updatedAt} />
      {leagues.data ? <LeaguePicker leagues={leagues.data} /> : null}
      <H>Standings</H>
      {st.loading && !st.data && leagueId ? <Text style={{ color: C.sub, fontSize: 16 }} testID="loading-indicator">Loading table…</Text> : null}
      {st.error && !st.data ? <ErrorBanner message={st.error} onRetry={st.reload} /> : null}
      {st.data && st.data.table.length === 0 ? <EmptyState title="No standings yet" hint="The table appears after matches are played." icon="trophy-outline" /> : null}
      {st.data && st.data.table.length > 0 ? (
        <Text style={{ color: C.sub, fontSize: 14 }}>Top {st.data.qualification_spots} qualify. P played, W won, D drawn, L lost, GD difference, Pts points.</Text>
      ) : null}
      {(st.data?.table ?? []).map((r) => {
        const nm = r.team_name ?? r.name ?? names.get(r.team_id) ?? r.team_id;
        return (
          <Card key={r.team_id} testID={`standing-${r.team_id}`} label={`Rank ${r.rank} ${nm}, ${r.points} points, ${r.status.replace('_', ' ')}`} onPress={() => router.push({ pathname: '/club/[id]', params: { id: r.team_id, name: nm } })}>
            <View style={s.head}>
              <Text style={s.rank}>{r.rank}</Text>
              <Text style={s.name} numberOfLines={2}>{nm}</Text>
              <Text style={s.pts}>{r.points} pts</Text>
            </View>
            <Text style={s.stats}>P {r.played}  W {r.won}  D {r.drawn}  L {r.lost}  GD {r.diff}</Text>
            <QBadge status={r.status} />
          </Card>
        );
      })}
    </Screen>
  );
}
const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rank: { fontSize: 20, fontWeight: '800', color: C.text, minWidth: 28 },
  name: { flex: 1, fontSize: 17, fontWeight: '700', color: C.text },
  pts: { fontSize: 18, fontWeight: '800', color: C.text },
  stats: { fontSize: 14, color: C.sub, marginVertical: 6 },
});
