import React, { useMemo, useState } from 'react';
import { Text } from 'react-native';
import { router, Stack } from 'expo-router';
import { api, friendly } from '@/api/client';
import type { Fixture } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { Screen, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Chips } from '@/components/Chips';
import { ErrorBanner } from '@/components/ErrorBanner';

/** Organizers create a fixture (match_init) in their league; it gets a dynamic QR code automatically. */
export default function CreateMatch() {
  const { session, leagueId } = useApp();
  const league = leagueId ?? session?.user.league_id ?? 'league-alpha-1';
  const fx = useCached<Fixture[]>(`fixtures:${league}`, async () => (await api<{ fixtures: Fixture[] }>(`/api/v1/fixtures?league_id=${encodeURIComponent(league)}`)).fixtures ?? []);
  const teams = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of fx.data ?? []) {
      m.set(f.home_team_id, f.home_name ?? f.home_team_id);
      m.set(f.away_team_id, f.away_name ?? f.away_team_id);
    }
    return [...m.entries()].map(([value, label]) => ({ value, label }));
  }, [fx.data]);
  const [home, setHome] = useState<string | null>(null);
  const [away, setAway] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    if (!home || !away || home === away) return setErr('Pick two different teams.');
    setBusy(true);
    setErr(null);
    const id = `match-${Date.now().toString(36)}`;
    try {
      await api('/api/v1/events', {
        body: { event_id: `${id}-init`, match_id: id, type: 'match_init', payload: { sport_id: 'football', home_team_id: home, away_team_id: away, league_id: league } },
      });
      router.replace(`/match/${id}`);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const role = session?.user.role;
  if (role !== 'league_organizer' && role !== 'super_admin')
    return (
      <Screen testID="screen-create-match">
        <Card><Text style={T.body}>Only league organizers can create matches.</Text></Card>
      </Screen>
    );
  return (
    <Screen testID="screen-create-match" loading={fx.loading && !fx.data}>
      <Stack.Screen options={{ title: 'Create match' }} />
      {err ? <ErrorBanner message={err} /> : null}
      <Text style={T.sub}>League: {league}</Text>
      <Text style={T.body}>Home team</Text>
      <Chips testIDPrefix="create-home" value={home} onChange={setHome} options={teams} />
      <Text style={T.body}>Away team</Text>
      <Chips testIDPrefix="create-away" value={away} onChange={setAway} options={teams.filter((t) => t.value !== home)} />
      <Button testID="create-submit" label="Create match" icon="add-circle" onPress={create} loading={busy} />
    </Screen>
  );
}
