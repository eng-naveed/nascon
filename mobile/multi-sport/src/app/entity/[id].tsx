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
import { LiveChat } from '@/components/LiveChat';
import { C, F, fmtTime } from '@/theme';

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
          <Text style={s.h}>Live chat</Text>
          <LiveChat room={`chat-${id}`} prefix="match" inline />
          {session ? (
            <Button testID="entity-open-match" label="Open full match centre" icon="stats-chart" variant="secondary" onPress={() => router.push(`/match/${id}`)} />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

type Profile = {
  player_id: string;
  name: string | null;
  club_id: string | null;
  career: { matches_played: number; wins: number; draws: number; losses: number; goals_or_points: number };
  upcoming_fixtures: { match_id: string; home: string; away: string; scheduled_at: string | null; status: string }[];
  vod_archive: { stream_key_label: string; status: string; ended_at: string | null; playback_url: string | null }[];
};
type Followers = { follower_count: number; following?: boolean };

function ProfileLink({ id }: { id: string }) {
  const isClub = id.startsWith('club-');
  return isClub ? <ClubLink id={id} /> : <AthleteProfile id={id} />;
}

function ClubLink({ id }: { id: string }) {
  const { session } = useApp();
  return (
    <Screen testID="screen-entity-profile">
      <Stack.Screen options={{ title: 'Club' }} />
      <Card testID="entity-profile">
        <Text style={s.team}>{id}</Text>
        <Text style={T.sub}>Club profile</Text>
      </Card>
      {session ? <Button testID="entity-open-club" label="Open club profile" icon="shield" onPress={() => router.push(`/club/${id}`)} /> : null}
    </Screen>
  );
}

/** FR-3.1 athlete profile: career record, upcoming fixtures, VOD archive and a follow toggle (members only). */
function AthleteProfile({ id }: { id: string }) {
  const { session } = useApp();
  const [p, setP] = useState<Profile | null>(null);
  const [f, setF] = useState<Followers | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const enc = encodeURIComponent(id);
      const [prof, fol] = await Promise.all([
        api<Profile>(`/api/v1/players/${enc}/profile`, { auth: false }),
        api<Followers>(`/api/v1/players/${enc}/followers`, { auth: !!session }),
      ]);
      setP(prof);
      setF(fol);
      setErr(null);
    } catch (e) {
      setErr(friendly(e));
    }
  }, [id, session]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await api<{ following: boolean; follower_count: number }>(`/api/v1/players/${encodeURIComponent(id)}/follow`, { method: f.following ? 'DELETE' : 'POST' });
      setF({ following: r.following, follower_count: r.follower_count });
      setErr(null);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const c = p?.career;
  return (
    <Screen testID="screen-entity-profile" onRefresh={load}>
      <Stack.Screen options={{ title: 'Athlete' }} />
      {err ? <ErrorBanner message={err} onRetry={load} /> : null}
      <Card testID="entity-profile">
        <View style={{ alignItems: 'center', gap: 6 }}>
          <TeamMark id={id} name={p?.name ?? id} size={64} />
          <Text style={s.name}>{p?.name ?? id}</Text>
          {p?.club_id ? <Text style={T.sub}>{p.club_id}</Text> : null}
          <Text style={T.sub} testID="athlete-follower-count">{f ? `${f.follower_count} ${f.follower_count === 1 ? 'follower' : 'followers'}` : ' '}</Text>
        </View>
      </Card>
      {session ? (
        <Button
          testID="athlete-follow"
          label={f?.following ? 'Following ✓' : 'Follow'}
          icon={f?.following ? undefined : 'person-add'}
          variant={f?.following ? 'secondary' : 'primary'}
          loading={busy}
          disabled={!f}
          onPress={toggle}
        />
      ) : (
        <Text style={T.sub}>Log in to follow this athlete.</Text>
      )}
      {c ? (
        <Card testID="athlete-career">
          <Text style={s.h}>Career</Text>
          <View style={s.stats}>
            {([['P', c.matches_played], ['W', c.wins], ['D', c.draws], ['L', c.losses], ['Pts', c.goals_or_points]] as const).map(([k, v]) => (
              <View key={k} style={s.stat}>
                <Text style={s.statV}>{v}</Text>
                <Text style={T.sub}>{k}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      {p ? (
        <Card testID="athlete-fixtures">
          <Text style={s.h}>Upcoming fixtures</Text>
          {p.upcoming_fixtures.length ? (
            p.upcoming_fixtures.map((m) => (
              <Text key={m.match_id} style={s.line} onPress={() => router.push(`/entity/${m.match_id}`)}>
                {m.home} v {m.away} · {fmtTime(m.scheduled_at)}
              </Text>
            ))
          ) : (
            <Text style={T.sub}>No upcoming fixtures.</Text>
          )}
        </Card>
      ) : null}
      {p ? (
        <Card testID="athlete-vod">
          <Text style={s.h}>Past streams</Text>
          {p.vod_archive.length ? (
            p.vod_archive.map((v, i) => (
              <Text key={`${v.stream_key_label}-${i}`} style={s.line}>
                {v.stream_key_label} · {v.status}{v.ended_at ? ` · ${fmtTime(v.ended_at)}` : ''}
              </Text>
            ))
          ) : (
            <Text style={T.sub}>No past streams yet.</Text>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 8 },
  side: { flex: 1, alignItems: 'center', gap: 6 },
  team: { color: C.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  score: { fontSize: 48, fontFamily: F.displayHeavy, color: C.text },
  name: { color: C.text, fontSize: 26, fontFamily: F.displayHeavy, textAlign: 'center' },
  h: { color: C.text, fontSize: 18, fontFamily: F.displayHeavy, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statV: { color: C.accent, fontSize: 28, fontFamily: F.displayHeavy },
  line: { color: C.text, fontSize: 15, paddingVertical: 6 },
});
