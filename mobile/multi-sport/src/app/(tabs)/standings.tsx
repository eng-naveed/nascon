import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/api/client';
import type { Fixture, Match, Standings, StandingRow } from '@/api/types';
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
import { Skeleton } from '@/components/feedback';
import { C, F, fmtTime, money } from '@/theme';

/** Dark hero card for the live (or latest) match, with the pinned merchandise underneath. */
function FeaturedMatch({ f }: { f: Fixture }) {
  const mq = useCached<Match>(`match:${f.match_id}`, () => api<Match>(`/api/v1/matches/${encodeURIComponent(f.match_id)}`), { pollMs: 5000 });
  const sc = mq.data?.showcase ?? null;
  const open = () => router.push({ pathname: '/match/[id]', params: { id: f.match_id, home: f.home_name, away: f.away_name } });
  return (
    <Pressable
      testID="featured-match"
      accessibilityRole="button"
      accessibilityLabel={`${f.status === 'in_progress' ? 'Live now' : 'Latest match'}: ${f.home_name} ${f.home_score ?? 0} to ${f.away_score ?? 0} ${f.away_name}. Opens the timeline and merchandise.`}
      onPress={open}
      style={({ pressed }) => [s.hero, pressed && { transform: [{ scale: 0.985 }] }]}
    >
      <View style={s.heroTop}>
        <StatusBadge status={f.status} />
        <Text style={s.heroTime}>{fmtTime(f.scheduled_at)}</Text>
      </View>
      <View style={s.heroRow}>
        <View style={s.heroSide}>
          <TeamMark id={f.home_team_id} name={f.home_name} size={52} />
          <Text style={s.heroName} numberOfLines={2}>{f.home_name}</Text>
        </View>
        <Text style={s.heroScore}>{f.home_score ?? 0} : {f.away_score ?? 0}</Text>
        <View style={s.heroSide}>
          <TeamMark id={f.away_team_id} name={f.away_name} size={52} />
          <Text style={s.heroName} numberOfLines={2}>{f.away_name}</Text>
        </View>
      </View>
      <Text style={s.heroHint}>TAP FOR TIMELINE &amp; MERCH</Text>
      {sc ? (
        <Pressable
          testID="featured-showcase"
          accessibilityRole="button"
          accessibilityLabel={`Pinned product ${sc.product_name}, ${money(sc.price_minor)}. Opens the store.`}
          onPress={() => router.push('/store')}
          style={s.pin}
        >
          <Ionicons name="shirt-outline" size={22} color={C.accent} />
          <Text style={s.pinText} numberOfLines={2}>Pinned: {sc.product_name} ({money(sc.price_minor)})</Text>
          <Ionicons name="chevron-forward" size={20} color={C.sub} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function Seg({ value, onChange, matches }: { value: 'table' | 'matches'; onChange: (v: 'table' | 'matches') => void; matches: number }) {
  const opt = (v: 'table' | 'matches', label: string, icon: React.ComponentProps<typeof Ionicons>['name']) => {
    const on = value === v;
    return (
      <Pressable
        key={v}
        testID={`standings-tab-${v}`}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={label}
        onPress={() => onChange(v)}
        style={[s.seg, on && s.segOn]}
      >
        <Ionicons name={icon} size={20} color={on ? C.bg : C.text} />
        <Text style={[s.segT, on && { color: C.bg }]}>{label}</Text>
      </Pressable>
    );
  };
  return <View style={s.segWrap}>{opt('table', 'Standings table', 'trophy-outline')}{opt('matches', `All matches (${matches})`, 'calendar-outline')}</View>;
}

export default function StandingsScreen() {
  const { leagueId, session } = useApp();
  const [mode, setMode] = useState<'table' | 'matches'>('table');
  const leagues = useLeagues();
  const st = useCached<Standings>(leagueId ? `standings:${leagueId}` : null, () => api<Standings>(`/api/v1/standings/${encodeURIComponent(leagueId!)}`), { pollMs: 10000 });
  const fx = useCached<Fixture[]>(leagueId ? `fixtures:${leagueId}` : null, async () => (await api<{ fixtures: Fixture[] }>(`/api/v1/fixtures?league_id=${encodeURIComponent(leagueId!)}`)).fixtures ?? [], { pollMs: 5000 });
  const names = new Map<string, string>();
  (fx.data ?? []).forEach((f) => { names.set(f.home_team_id, f.home_name); names.set(f.away_team_id, f.away_name); });
  const fixtures = fx.data ?? [];
  const featured = fixtures.find((f) => f.status === 'in_progress') ?? [...fixtures].reverse().find((f) => f.status === 'completed') ?? fixtures[0];
  const myClub = session?.user.club_id ?? null;
  const spots = st.data?.qualification_spots ?? 0;

  return (
    <Screen testID="screen-standings" loading={leagues.loading && !leagues.data} onRefresh={() => Promise.all([st.reload(), fx.reload()])}>
      <CacheNote fromCache={st.fromCache} updatedAt={st.updatedAt} />
      {leagues.data ? <LeaguePicker leagues={leagues.data} /> : null}
      <H>Standings &amp; matches</H>
      {featured ? <FeaturedMatch f={featured} /> : null}
      <Seg value={mode} onChange={setMode} matches={fixtures.length} />

      {mode === 'table' ? (
        <>
          {st.loading && !st.data && leagueId ? <Skeleton rows={5} height={56} label="Loading table" /> : null}
          {st.error && !st.data ? <ErrorBanner message={st.error} onRetry={st.reload} /> : null}
          {st.data && st.data.table.length === 0 ? <EmptyState title="No standings yet" hint="The table appears after matches are played." icon="trophy-outline" /> : null}
          {st.data && st.data.table.length > 0 ? (
            <View style={s.table} testID="standings-table">
              <View style={s.thead}>
                <Text style={[s.th, { width: 34 }]}>#</Text>
                <Text style={[s.th, { flex: 1 }]}>Club</Text>
                {['P', 'W', 'D', 'L', 'GD'].map((h) => <Text key={h} style={[s.th, s.num]}>{h}</Text>)}
                <Text style={[s.th, s.pts]}>Pts</Text>
              </View>
              {st.data.table.map((r: StandingRow) => {
                const nm = r.team_name ?? r.name ?? names.get(r.team_id) ?? r.team_id;
                const q = r.rank <= spots;
                const mine = !!myClub && r.team_id === myClub;
                const gd = Number(r.diff);
                return (
                  <Pressable
                    key={r.team_id}
                    testID={`standing-${r.team_id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Rank ${r.rank} ${nm}${mine ? ', your squad' : ''}, ${r.points} ${r.points === 1 ? 'point' : 'points'}, played ${r.played}, won ${r.won}, drawn ${r.drawn}, lost ${r.lost}${q ? ', in a qualifying place' : ''}, ${r.status.replace('_', ' ')}. Opens club profile and matches.`}
                    onPress={() => router.push({ pathname: '/club/[id]', params: { id: r.team_id, name: nm } })}
                    style={({ pressed }) => [s.tr, mine && s.trMine, pressed && { backgroundColor: C.card2 }]}
                  >
                    <View style={{ width: 34, alignItems: 'flex-start' }}>
                      <View style={[s.rankBox, q && { backgroundColor: C.accent, borderColor: C.accent }]}>
                        <Text style={[s.rank, q && { color: C.bg }]}>{r.rank}</Text>
                      </View>
                    </View>
                    <View style={{ flex: 1, paddingRight: 4 }}>
                      <Text style={[s.club, mine && { color: C.accent }]} numberOfLines={1}>{nm}</Text>
                      <View style={s.tags}>
                        {mine ? <Text style={s.tagMine}>OUR SQUAD</Text> : null}
                        {q ? <Text style={s.tagQ}>✓ Q</Text> : null}
                        {r.status === 'clinched' ? <Text style={s.tagOk}>CLINCHED</Text> : r.status === 'eliminated' ? <Text style={s.tagBad}>OUT</Text> : null}
                      </View>
                    </View>
                    <Text style={[s.td, s.num]}>{r.played}</Text>
                    <Text style={[s.td, s.num]}>{r.won}</Text>
                    <Text style={[s.td, s.num]}>{r.drawn}</Text>
                    <Text style={[s.td, s.num]}>{r.lost}</Text>
                    <Text style={[s.td, s.num, gd > 0 ? { color: C.ok } : gd < 0 ? { color: C.bad } : null]}>{gd > 0 ? '+' : ''}{r.diff}</Text>
                    <Text style={[s.td, s.pts, s.ptsStrong]}>{r.points}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {st.data && st.data.table.length > 0 ? (
            <Text style={s.legend}>Top {spots} qualify (✓ Q). P played, W won, D drawn, L lost, GD goal/point difference, Pts points. Tap a team to see its matches.</Text>
          ) : null}
        </>
      ) : (
        <>
          {fx.loading && !fx.data ? <Skeleton rows={4} height={72} label="Loading matches" /> : null}
          {fx.error && !fx.data ? <ErrorBanner message={fx.error} onRetry={fx.reload} /> : null}
          {fixtures.length === 0 && !fx.loading ? <EmptyState title="No matches yet" hint="Fixtures will appear here once the schedule is published." icon="calendar-outline" /> : null}
          {fixtures.map((f) => (
            <Card key={f.match_id} testID={`standings-match-${f.match_id}`} label={`${f.home_name} versus ${f.away_name}, ${f.status}`} onPress={() => router.push({ pathname: '/match/[id]', params: { id: f.match_id, home: f.home_name, away: f.away_name } })}>
              <View style={s.mTop}>
                <StatusBadge status={f.status} />
                <Text style={s.heroTime}>{fmtTime(f.scheduled_at)}</Text>
              </View>
              <View style={s.mRow}>
                <Text style={s.mName} numberOfLines={1}>{f.home_name}</Text>
                <Text style={s.mScore}>{f.status === 'upcoming' ? 'vs' : `${f.home_score ?? 0} - ${f.away_score ?? 0}`}</Text>
                <Text style={[s.mName, { textAlign: 'right' }]} numberOfLines={1}>{f.away_name}</Text>
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: '#0E1A33', borderRadius: 22, padding: 16, gap: 10, borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroTime: { fontSize: 13, color: C.sub, fontWeight: '600' },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroSide: { flex: 1, alignItems: 'center', gap: 6 },
  heroName: { fontSize: 14, fontWeight: '800', color: C.text, textAlign: 'center' },
  heroScore: { fontSize: 54, fontFamily: F.displayHeavy, color: C.text, minWidth: 130, textAlign: 'center', letterSpacing: 2 },
  heroHint: { fontSize: 12, fontWeight: '800', color: C.info, letterSpacing: 1.2, textAlign: 'center' },
  pin: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12, minHeight: 48 },
  pinText: { flex: 1, fontSize: 14, fontWeight: '700', color: C.text },
  segWrap: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 18, padding: 4, borderWidth: 1, borderColor: C.border, gap: 4 },
  seg: { flex: 1, minHeight: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6 },
  segOn: { backgroundColor: C.accent },
  segT: { fontSize: 14, fontWeight: '800', color: C.text },
  table: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  thead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.card2 },
  th: { fontSize: 12, fontWeight: '800', color: C.sub, letterSpacing: 0.6 },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 58, borderTopWidth: 1, borderTopColor: C.border },
  trMine: { backgroundColor: 'rgba(200,255,61,0.08)', borderLeftWidth: 4, borderLeftColor: C.accent },
  rankBox: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' },
  rank: { fontSize: 17, fontFamily: F.displayHeavy, color: C.text },
  club: { fontSize: 15, fontWeight: '800', color: C.text },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tagMine: { fontSize: 10, fontWeight: '900', color: C.accent, letterSpacing: 0.6 },
  tagQ: { fontSize: 10, fontWeight: '900', color: C.accent, letterSpacing: 0.6 },
  tagOk: { fontSize: 10, fontWeight: '900', color: C.ok, letterSpacing: 0.6 },
  tagBad: { fontSize: 10, fontWeight: '900', color: C.bad, letterSpacing: 0.6 },
  td: { fontSize: 14, fontWeight: '700', color: C.text },
  num: { width: 28, textAlign: 'center' },
  pts: { width: 38, textAlign: 'right' },
  ptsStrong: { fontSize: 18, fontFamily: F.displayHeavy, color: C.accent },
  legend: { fontSize: 13, color: C.sub, lineHeight: 18 },
  mTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  mRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mName: { flex: 1, fontSize: 15, fontWeight: '800', color: C.text },
  mScore: { fontSize: 24, fontFamily: F.displayHeavy, color: C.accent, minWidth: 64, textAlign: 'center' },
});
