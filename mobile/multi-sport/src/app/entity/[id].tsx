import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack, router, useLocalSearchParams } from 'expo-router';
import { api, friendly } from '@/api/client';
import { hlsUrl, useLiveSocket, wsUrl } from '@/api/live';
import { useApp } from '@/state/app';
import { Screen, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { StatusBadge } from '@/components/StatusBadge';
import { TeamMark } from '@/components/TeamMark';
import { ScorePop } from '@/components/feedback';
import { LivePlayer } from '@/components/LivePlayer';
import { C, F } from '@/theme';

/**
 * Public deep-link target nascon://entity/{id} (spec 6.3, FR-4.1 hybrid routing). Opens without a login:
 * a match shows the live scoreboard + venue feed over WebSocket; a co-stream goes to its stream screen.
 */
export default function EntityLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const entity = String(id ?? '');
  if (entity.startsWith('cs-session-')) return <Redirect href={`/stream/${entity}`} />;
  if (entity.startsWith('player-') || entity.startsWith('club-')) return <ProfileLink id={entity} />;
  return <LiveMatch id={entity} />;
}

type Score = { status: string; home: { team_id: string; score: number }; away: { team_id: string; score: number } };

function LiveMatch({ id }: { id: string }) {
  const { session } = useApp();
  const [score, setScore] = useState<Score | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setScore(await api<Score>(`/audit/v1/score/${encodeURIComponent(id)}`, { auth: false }));
      setErr(null);
    } catch (e) {
      setErr(friendly(e));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  // live score pushed by the server within milliseconds of each committed event
  useLiveSocket(wsUrl(`/ws/matches/${encodeURIComponent(id)}`), (m) => {
    if (m.type === 'score' && m.score) setScore(m.score);
  });
  return (
    <Screen testID="screen-entity-match" onRefresh={load}>
      <Stack.Screen options={{ title: 'Live match' }} />
      {err && !score ? <ErrorBanner message={err} onRetry={load} /> : null}
      {score ? (
        <>
          {score.status === 'in_progress' ? <LivePlayer uri={hlsUrl(`match/${id}`)} label="Live match video" testID="match-video" /> : null}
          <Card testID="match-scoreboard">
            <View style={{ alignItems: 'center', gap: 8 }}>
              <StatusBadge status={score.status} />
              <View style={s.row}>
                <View style={s.side}>
                  <TeamMark id={score.home.team_id} name={score.home.team_id} size={56} />
                  <Text style={s.team} numberOfLines={2}>{score.home.team_id}</Text>
                </View>
                <ScorePop style={s.score} testID="match-score" accessibilityLabel={`Score ${score.home.score} to ${score.away.score}`} value={`${score.home.score} - ${score.away.score}`} />
                <View style={s.side}>
                  <TeamMark id={score.away.team_id} name={score.away.team_id} size={56} />
                  <Text style={s.team} numberOfLines={2}>{score.away.team_id}</Text>
                </View>
              </View>
              <Text style={T.sub}>Live over WebSocket. No account needed to watch.</Text>
            </View>
          </Card>
          {session ? (
            <Button testID="entity-open-match" label="Open full match centre" icon="stats-chart" variant="secondary" onPress={() => router.push(`/match/${id}`)} />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function ProfileLink({ id }: { id: string }) {
  const { session } = useApp();
  const isClub = id.startsWith('club-');
  return (
    <Screen testID="screen-entity-profile">
      <Stack.Screen options={{ title: isClub ? 'Club' : 'Athlete' }} />
      <Card testID="entity-profile">
        <Text style={s.team}>{id}</Text>
        <Text style={T.sub}>{isClub ? 'Club profile' : 'Athlete profile'}</Text>
      </Card>
      {isClub && session ? <Button testID="entity-open-club" label="Open club profile" icon="shield" onPress={() => router.push(`/club/${id}`)} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 },
  side: { flex: 1, alignItems: 'center', gap: 6 },
  team: { color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  score: { fontSize: 48, fontFamily: F.displayHeavy, color: C.text },
});
