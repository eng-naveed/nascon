import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/api/client';
import type { Club, Fixture } from '@/api/types';
import { useApp } from '@/state/app';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/feedback';
import { useCached } from '@/state/useCached';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { CacheNote } from '@/components/CacheNote';
import { Badge } from '@/components/Badge';
import { C, F, fmtTime } from '@/theme';

/** This club's fixtures (from the league fixtures, cached for offline). Each card opens the match. */
function ClubMatches({ clubId }: { clubId: string }) {
  const { leagueId } = useApp();
  const fx = useCached<Fixture[]>(leagueId ? `fixtures:${leagueId}` : null, async () => (await api<{ fixtures: Fixture[] }>(`/api/v1/fixtures?league_id=${encodeURIComponent(leagueId!)}`)).fixtures ?? []);
  const order = { in_progress: 0, upcoming: 1, completed: 2 } as const;
  const mine = (fx.data ?? []).filter((f) => f.home_team_id === clubId || f.away_team_id === clubId).sort((a, b) => order[a.status] - order[b.status]);
  return (
    <>
      <H>Matches</H>
      {fx.loading && !fx.data && leagueId ? <Skeleton rows={2} height={80} label="Loading matches" /> : null}
      {fx.data && mine.length === 0 ? <EmptyState title="No matches scheduled" hint="This club's matches will appear here once fixtures are published." icon="calendar-outline" /> : null}
      {mine.map((f) => {
        const score = f.status === 'upcoming' ? 'VS' : `${f.home_score ?? 0} - ${f.away_score ?? 0}`;
        return (
          <Card
            key={f.match_id}
            testID={`club-match-${f.match_id}`}
            label={`${f.home_name} versus ${f.away_name}, ${f.status === 'upcoming' ? `upcoming, ${fmtTime(f.scheduled_at)}` : `${f.status === 'in_progress' ? 'live' : 'final'} score ${f.home_score ?? 0} to ${f.away_score ?? 0}`}. Open match.`}
            onPress={() => router.push({ pathname: '/match/[id]', params: { id: f.match_id, home: f.home_name, away: f.away_name } })}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <StatusBadge status={f.status} />
              <Text style={T.sub}>{fmtTime(f.scheduled_at)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '800', color: C.text }} numberOfLines={2}>{f.home_name}</Text>
              <Text style={{ fontSize: 26, fontFamily: F.displayHeavy, color: f.status === 'upcoming' ? C.sub : C.accent, minWidth: 64, textAlign: 'center' }}>{score}</Text>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '800', color: C.text, textAlign: 'right' }} numberOfLines={2}>{f.away_name}</Text>
              <Ionicons name="chevron-forward" size={18} color={C.sub} />
            </View>
          </Card>
        );
      })}
    </>
  );
}

export function ClubProfile({ clubId, fallbackName }: { clubId: string; fallbackName?: string }) {
  const q = useCached<Club>(`club:${clubId}`, () => api<Club>(`/api/v1/clubs/${encodeURIComponent(clubId)}`));
  const c = q.data;
  return (
    <Screen testID="screen-club" loading={q.loading && !c} onRefresh={q.reload}>
      <CacheNote fromCache={q.fromCache} updatedAt={q.updatedAt} />
      {q.error && !c ? <ErrorBanner message={q.error.includes('not be found') ? `No club profile is available for ${fallbackName ?? 'this team'}.` : q.error} onRetry={q.reload} /> : null}
      {q.error && !c ? <ClubMatches clubId={clubId} /> : null}
      {c ? (
        <>
          <Text style={{ fontSize: 26, fontWeight: '800', color: C.text }} accessibilityRole="header" testID="club-name">{c.name}</Text>
          <ClubMatches clubId={c.club_id ?? clubId} />
          <H>Home venue</H>
          <Card>
            <Text style={T.body}>{c.home_venue?.name ?? 'Venue not announced yet'}</Text>
            {c.home_venue?.lat != null ? <Text style={T.sub}>Location: {c.home_venue.lat}, {c.home_venue.lng}</Text> : null}
            {c.social?.twitter ? <Text style={T.sub}>Twitter: {c.social.twitter}</Text> : null}
            {c.social?.instagram ? <Text style={T.sub}>Instagram: {c.social.instagram}</Text> : null}
          </Card>
          <H>Staff</H>
          {(c.staff ?? []).length === 0 ? <EmptyState title="No staff listed" icon="people-outline" /> : null}
          {(c.staff ?? []).map((m, i) => (
            <Card key={i} testID={`staff-${i}`}>
              <Text style={T.body}>{m.name}</Text>
              <Text style={T.sub}>{m.role}</Text>
            </Card>
          ))}
          <H>Roster</H>
          {(c.roster ?? []).length === 0 ? <EmptyState title="No players yet" hint="Players will appear once the roster is set." icon="person-outline" /> : null}
          {(c.roster ?? []).map((p) => (
            <Card key={p.player_id} testID={`player-${p.player_id}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={T.body}>{p.name}</Text>
                  <Text style={T.sub}>Position: {p.position}</Text>
                </View>
                <Badge text={p.role.replace('_', ' ')} />
              </View>
            </Card>
          ))}
          {(c.history ?? []).length > 0 ? <H>Season history</H> : null}
          {(c.history ?? []).map((h) => (
            <Card key={h.season}>
              <Text style={T.body}>{h.season}</Text>
              <Text style={T.sub}>Played {h.played}  Won {h.won}  Drawn {h.drawn}  Lost {h.lost}</Text>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
