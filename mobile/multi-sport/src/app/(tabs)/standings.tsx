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
import { TeamMark } from '@/components/TeamMark';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton } from '@/components/feedback';
import { C, F } from '@/theme';

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
    <Screen testID="screen-standings" loading={leagues.loading && !leagues.data} onRefresh={() => Promise.all([st.reload(), fx.reload()])}>
      <CacheNote fromCache={st.fromCache} updatedAt={st.updatedAt} />
      {leagues.data ? <LeaguePicker leagues={leagues.data} /> : null}
      <H>Standings</H>
      {st.loading && !st.data && leagueId ? <Skeleton rows={4} height={110} label="Loading table" /> : null}
      {st.error && !st.data ? <ErrorBanner message={st.error} onRetry={st.reload} /> : null}
      {st.data && st.data.table.length === 0 ? <EmptyState title="No standings yet" hint="The table appears after matches are played." icon="trophy-outline" /> : null}
      {st.data && st.data.table.length > 0 ? (
        <Text style={{ color: C.sub, fontSize: 14 }}>Top {st.data.qualification_spots} qualify (marked Q). P played, W won, D drawn, L lost, GD difference, Pts points. Tap a team to see its matches.</Text>
      ) : null}
      {(st.data?.table ?? []).map((r) => {
        const nm = r.team_name ?? r.name ?? names.get(r.team_id) ?? r.team_id;
        const q = r.rank <= (st.data?.qualification_spots ?? 0);
        return (
          <Card key={r.team_id} testID={`standing-${r.team_id}`} label={`Rank ${r.rank} ${nm}, ${r.points} points${q ? ', in a qualifying place' : ''}, ${r.status.replace('_', ' ')}. Opens club profile and matches.`} onPress={() => router.push({ pathname: '/club/[id]', params: { id: r.team_id, name: nm } })}>
            <View style={s.head}>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <View style={[s.rankBox, q && { backgroundColor: C.accent, borderColor: C.accent }]}>
                  <Text style={[s.rank, q && { color: C.bg }]}>{r.rank}</Text>
                </View>
                {q ? <Text style={s.qTag}>✓ Q</Text> : null}
              </View>
              <TeamMark id={r.team_id} name={nm} size={40} />
              <Text style={s.name} numberOfLines={2}>{nm}</Text>
              <Text style={s.pts}>{r.points}<Text style={s.ptsLbl}> pts</Text></Text>
            </View>
            <Text style={s.stats}>P {r.played}  W {r.won}  D {r.drawn}  L {r.lost}  GD {r.diff}</Text>
            <View style={s.foot}>
              <QBadge status={r.status} />
              <View style={s.more}>
                <Text style={s.moreT}>See matches</Text>
                <Ionicons name="chevron-forward" size={18} color={C.text} />
              </View>
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rankBox: { width: 34, height: 34, borderRadius: 10, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
  rank: { fontSize: 22, fontFamily: F.displayHeavy, color: C.text },
  name: { flex: 1, fontSize: 16, fontWeight: '800', color: C.text },
  pts: { fontSize: 30, fontFamily: F.displayHeavy, color: C.accent },
  ptsLbl: { fontSize: 14, fontFamily: F.display, color: C.sub },
  qTag: { fontSize: 11, fontWeight: '900', color: C.accent, letterSpacing: 0.5 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32 },
  moreT: { fontSize: 14, fontWeight: '800', color: C.text },
  stats: { fontSize: 13, color: C.sub, marginVertical: 8, fontWeight: '600', letterSpacing: 0.3 },
});
