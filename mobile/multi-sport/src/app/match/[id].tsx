import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/api/client';
import type { Match } from '@/api/types';
import { useCached } from '@/state/useCached';
import { useApp } from '@/state/app';
import { describeEvent } from '@/features/match/describe';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { CacheNote } from '@/components/CacheNote';
import { StatusBadge } from '@/components/StatusBadge';
import { C, money } from '@/theme';

export default function MatchDetail() {
  const { id, home, away } = useLocalSearchParams<{ id: string; home?: string; away?: string }>();
  const { session } = useApp();
  const q = useCached<Match>(`match:${id}`, () => api<Match>(`/api/v1/matches/${encodeURIComponent(String(id))}`), { pollMs: 3000 });
  const m = q.data;
  const names: Record<string, string> = {};
  if (m) {
    names[m.home.team_id] = String(home ?? m.home.team_id);
    names[m.away.team_id] = String(away ?? m.away.team_id);
  }
  const canScore = session?.user.role === 'league_organizer' || session?.user.role === 'super_admin';
  return (
    <Screen testID="screen-match" loading={q.loading && !m} onRefresh={q.reload}>
      <CacheNote fromCache={q.fromCache} updatedAt={q.updatedAt} />
      {q.error && !m ? <ErrorBanner message={q.error} onRetry={q.reload} /> : null}
      {m ? (
        <>
          <Card testID="match-scoreboard">
            <View style={{ alignItems: 'center', gap: 8 }}>
              <StatusBadge status={m.status} />
              <View style={s.row}>
                <Text style={s.team} numberOfLines={2}>{names[m.home.team_id]}</Text>
                <Text style={s.score} testID="match-score" accessibilityLabel={`Score ${m.home.score} to ${m.away.score}`}>{m.home.score} - {m.away.score}</Text>
                <Text style={[s.team, { textAlign: 'right' }]} numberOfLines={2}>{names[m.away.team_id]}</Text>
              </View>
              {m.status === 'completed' ? (
                <Text style={T.body} testID="match-outcome">
                  {m.outcome === 'draw' ? 'Result: draw' : m.winner_team_id ? `Winner: ${names[m.winner_team_id] ?? m.winner_team_id}` : 'Result: undecided'}
                </Text>
              ) : null}
              <Text style={T.sub}>{q.fromCache ? 'Saved score' : 'Live: refreshes every 3 seconds'}</Text>
            </View>
          </Card>
          {m.showcase ? (
            <Card testID="match-showcase" label={`Featured product ${m.showcase.product_name}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="pricetag" size={24} color={C.text} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.sub }}>FEATURED IN THIS MATCH</Text>
                  <Text style={T.body}>{m.showcase.product_name}</Text>
                  <Text style={T.sub}>{money(m.showcase.price_minor)}</Text>
                </View>
              </View>
              <View style={{ marginTop: 8 }}>
                <Button label="View in store" icon="cart" testID="showcase-open-store" onPress={() => router.push('/store')} />
              </View>
            </Card>
          ) : null}
          {canScore ? <Button label="Open scoring entry" icon="create" variant="secondary" testID="match-open-scoring" onPress={() => router.push({ pathname: '/scoring/[id]', params: { id: m.match_id, home: names[m.home.team_id], away: names[m.away.team_id] } })} /> : null}
          <H>Timeline</H>
          {m.events.length === 0 ? <EmptyState title="No events yet" hint="Goals and key moments will show up here." icon="list-outline" /> : null}
          {[...m.events].reverse().map((e) => (
            <Card key={e.event_id} testID={`event-${e.event_id}`}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Text style={s.seq}>#{e.sequence}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[T.body, e.compensated && { textDecorationLine: 'line-through', color: C.sub }]}>{describeEvent(e, names)}</Text>
                  {e.compensated ? <Text style={T.sub}>Undone by a correction</Text> : null}
                </View>
              </View>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  team: { flex: 1, fontSize: 17, fontWeight: '700', color: C.text },
  score: { fontSize: 40, fontWeight: '900', color: C.text, minWidth: 110, textAlign: 'center' },
  seq: { fontSize: 14, fontWeight: '800', color: C.sub, minWidth: 32 },
});
