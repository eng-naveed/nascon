import React, { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api, friendly } from '@/api/client';
import type { Match, Product, Sport } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { describeEvent } from '@/features/match/describe';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Chips } from '@/components/Chips';
import { Field } from '@/components/Field';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { CacheNote } from '@/components/CacheNote';
import { StatusBadge } from '@/components/StatusBadge';
import { uid, C } from '@/theme';

export default function Scoring() {
  const { id, home, away } = useLocalSearchParams<{ id: string; home?: string; away?: string }>();
  const mid = String(id);
  const { submitAction, online } = useApp();
  const mq = useCached<Match>(`match:${mid}`, () => api<Match>(`/api/v1/matches/${encodeURIComponent(mid)}`), { pollMs: 4000 });
  const sq = useCached<Sport[]>('sports', async () => (await api<{ sports: Sport[] }>('/api/v1/sports')).sports ?? []);
  const pq = useCached<Product[]>('products', async () => (await api<{ products: Product[] }>('/api/v1/store/products')).products ?? []);
  const m = mq.data;
  const sport = sq.data?.find((s) => s.sport_id === m?.sport_id);
  const evTypes = Object.keys(sport?.scoring_events ?? {});
  const [team, setTeam] = useState<string | null>(null);
  const [evType, setEvType] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [variant, setVariant] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  // Optimistic status after an action was sent or queued (so a pending offline "Start" cannot be queued twice).
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    setLocal(null);
  }, [m?.status]);
  const status = local ?? m?.status ?? 'upcoming';
  const canStart = status === 'upcoming';
  const canEnd = status === 'in_progress';
  const canScore = status === 'in_progress';
  const names: Record<string, string> = {};
  if (m) {
    names[m.home.team_id] = String(home ?? m.home.team_id);
    names[m.away.team_id] = String(away ?? m.away.team_id);
  }

  const send = (type: string, payload: Record<string, unknown>, summary: string, risky: boolean) => {
    const go = async () => {
      if (!m) return;
      setBusy(true);
      setMsg(null);
      try {
        const body = { event_id: uid('evt-'), match_id: mid, type, payload };
        const res = await submitAction('score_event', body, m.version, summary);
        if (type === 'match_start') setLocal('in_progress');
        if (type === 'match_end') setLocal('completed');
        setMsg(res === 'queued' ? { k: 'warn', t: 'Saved as pending. It will be sent when you are back online.' } : { k: 'ok', t: 'Done. The event was recorded.' });
        if (res === 'sent') mq.reload();
      } catch (e) {
        setMsg({ k: 'bad', t: friendly(e) });
      }
      setBusy(false);
    };
    if (risky) Alert.alert('Please confirm', `${summary}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', style: 'destructive', onPress: go }]);
    else go();
  };

  const pin = async () => {
    if (!variant) return setMsg({ k: 'bad', t: 'Choose a product first.' });
    try {
      await api(`/api/v1/matches/${encodeURIComponent(mid)}/showcase`, { body: { variant_id: variant } });
      setMsg({ k: 'ok', t: 'Product pinned to the match.' });
      mq.reload();
    } catch (e) {
      setMsg({ k: 'bad', t: friendly(e) });
    }
  };

  const activeEvents = (m?.events ?? []).filter((e) => ['score', 'discipline', 'tiebreak_winner'].includes(e.type) && !e.compensated);
  const teamOpts = m ? [{ value: m.home.team_id, label: names[m.home.team_id] }, { value: m.away.team_id, label: names[m.away.team_id] }] : [];

  return (
    <Screen testID="screen-scoring" loading={mq.loading && !m} onRefresh={mq.reload}>
      <CacheNote fromCache={mq.fromCache} updatedAt={mq.updatedAt} />
      {mq.error && !m ? <ErrorBanner message={mq.error} onRetry={mq.reload} /> : null}
      {m ? (
        <>
          <Card testID="scoring-summary">
            <StatusBadge status={m.status} />
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{names[m.home.team_id]} {m.home.score} - {m.away.score} {names[m.away.team_id]}</Text>
            <Text style={T.sub}>Sport: {m.sport_id} · version {m.version}</Text>
          </Card>
          {msg ? <ErrorBanner kind={msg.k} message={msg.t} /> : null}
          <H>Match state</H>
          <Button
            label={canStart ? 'Start match' : status === 'in_progress' ? 'Match is live' : 'Match finished'}
            icon={canStart ? 'play' : 'checkmark-circle'}
            variant={canStart ? 'primary' : 'secondary'}
            testID="score-start"
            disabled={busy || !canStart}
            onPress={() => send('match_start', {}, 'Start match', false)}
          />
          <Button
            label={canEnd ? 'End match' : status === 'completed' ? 'Match ended' : 'Start the match first'}
            icon={canEnd ? 'stop' : 'lock-closed'}
            variant={canEnd ? 'danger' : 'secondary'}
            testID="score-end"
            disabled={busy || !canEnd}
            onPress={() => send('match_end', {}, 'End this match', true)}
          />
          <H>Score event</H>
          {canScore ? (
            <>
              <Chips testIDPrefix="score-team" value={team} onChange={setTeam} options={teamOpts} />
              {evTypes.length === 0 ? <Field label="Event type" testID="score-event-type-input" value={evType ?? ''} onChangeText={setEvType} /> : <Chips testIDPrefix="score-type" value={evType} onChange={setEvType} options={evTypes.map((e) => ({ value: e, label: e.replace(/_/g, ' ') }))} />}
              <Button label="Add score event" icon="add-circle" testID="score-submit" disabled={busy || !team || !evType} onPress={() => send('score', { team_id: team, event_type: evType }, `Score: ${names[team!] ?? team} ${String(evType).replace(/_/g, ' ')}`, false)} />
              <H>Fair-play penalty</H>
              <Text style={T.sub}>Pick a team above, then record a penalty. It counts in the fair-play tie-break.</Text>
              <Button label="Caution (-1)" icon="warning" variant="secondary" testID="discipline-caution" disabled={busy || !team} onPress={() => send('discipline', { team_id: team, points: -1 }, `Penalty -1 for ${names[team!] ?? team}`, true)} />
              <Button label="Serious offence (-3)" icon="alert-circle" variant="danger" testID="discipline-serious" disabled={busy || !team} onPress={() => send('discipline', { team_id: team, points: -3 }, `Penalty -3 for ${names[team!] ?? team}`, true)} />
            </>
          ) : (
            <Text style={T.sub} testID="score-locked-hint">
              {status === 'upcoming' ? 'Start the match to add score events.' : 'This match has ended, so new score events cannot be added. You can still undo an earlier event below.'}
            </Text>
          )}
          <H>Undo an event (compensate)</H>
          {activeEvents.length === 0 ? <Text style={T.sub}>No events can be undone yet.</Text> : <Chips testIDPrefix="comp-target" value={target} onChange={setTarget} options={activeEvents.map((e) => ({ value: e.event_id, label: `#${e.sequence} ${describeEvent(e, names)}` }))} />}
          <Field label="Reason" testID="comp-reason" value={reason} onChangeText={setReason} autoCapitalize="sentences" />
          <Button label="Undo selected event" icon="arrow-undo" variant="danger" testID="comp-submit" disabled={busy || !target} onPress={() => send('compensation', { compensates: target, reason: reason.trim() || 'Correction' }, `Undo event ${target}`, true)} />
          <H>Pin a product</H>
          {!online ? <Text style={T.sub}>Pinning needs an internet connection.</Text> : null}
          <Chips testIDPrefix="pin" value={variant} onChange={setVariant} options={(pq.data ?? []).flatMap((p) => p.variants.map((v) => ({ value: v.variant_id, label: `${p.name} ${v.label}` })))} />
          <Button label="Pin to match" icon="pricetag" variant="secondary" testID="pin-submit" disabled={!online || !variant} onPress={pin} />
        </>
      ) : null}
    </Screen>
  );
}
