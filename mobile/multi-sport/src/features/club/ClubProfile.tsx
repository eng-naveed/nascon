import React from 'react';
import { Text, View } from 'react-native';
import { api } from '@/api/client';
import type { Club } from '@/api/types';
import { useCached } from '@/state/useCached';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { CacheNote } from '@/components/CacheNote';
import { Badge } from '@/components/Badge';
import { C } from '@/theme';

export function ClubProfile({ clubId, fallbackName }: { clubId: string; fallbackName?: string }) {
  const q = useCached<Club>(`club:${clubId}`, () => api<Club>(`/api/v1/clubs/${encodeURIComponent(clubId)}`));
  const c = q.data;
  return (
    <Screen testID="screen-club" loading={q.loading && !c} onRefresh={q.reload}>
      <CacheNote fromCache={q.fromCache} updatedAt={q.updatedAt} />
      {q.error && !c ? <ErrorBanner message={q.error.includes('not be found') ? `No club profile is available for ${fallbackName ?? 'this team'}.` : q.error} onRetry={q.reload} /> : null}
      {c ? (
        <>
          <Text style={{ fontSize: 26, fontWeight: '800', color: C.text }} accessibilityRole="header" testID="club-name">{c.name}</Text>
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
