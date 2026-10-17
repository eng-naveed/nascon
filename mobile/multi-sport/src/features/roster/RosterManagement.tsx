import React, { useState } from 'react';
import { Alert, Text } from 'react-native';
import { api, friendly } from '@/api/client';
import type { Roster } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { cacheGet, cacheSet } from '@/db';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Chips } from '@/components/Chips';
import { Field } from '@/components/Field';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { CacheNote } from '@/components/CacheNote';
import { isoNow, uid, C } from '@/theme';

type Kind = 'transfer' | 'loan' | 'release' | 'add';
const today = () => new Date().toISOString().slice(0, 10);

export function RosterManagement({ clubId }: { clubId: string }) {
  const { session, submitAction } = useApp();
  const q = useCached<Roster>(`roster:${clubId}`, () => api<Roster>(`/api/v1/roster/${encodeURIComponent(clubId)}`));
  const [kind, setKind] = useState<Kind>('transfer');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [manualPlayer, setManualPlayer] = useState('');
  const [fromSquad, setFromSquad] = useState('');
  const [toSquad, setToSquad] = useState('');
  const [date, setDate] = useState(today());
  const [loanEnd, setLoanEnd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad' | 'warn'; t: string } | null>(null);
  const r = q.data;
  const squads = r?.squads ?? [];
  const myPlayers = squads.flatMap((s) => s.players.map((p) => ({ ...p, squad_id: s.squad_id })));

  const submit = async () => {
    setMsg(null);
    const pid = kind === 'add' ? manualPlayer.trim() : playerId;
    if (!pid) return setMsg({ k: 'bad', t: 'Please choose a player.' });
    const own = squads[0]?.squad_id ?? '';
    const from = kind === 'add' ? fromSquad.trim() : myPlayers.find((p) => p.player_id === pid)?.squad_id ?? own;
    const to = kind === 'release' ? null : kind === 'add' ? own : toSquad.trim();
    if (kind !== 'release' && !to) return setMsg({ k: 'bad', t: 'Please enter the destination squad.' });
    if (kind === 'add' && !from) return setMsg({ k: 'bad', t: 'Please enter the squad the player is coming from.' });
    if (kind === 'loan' && !loanEnd.trim()) return setMsg({ k: 'bad', t: 'Please enter the loan end date (YYYY-MM-DD).' });
    const type = kind === 'add' ? 'transfer' : kind;
    const payload = {
      request_id: uid('tr-'),
      league_id: r?.league_id ?? session?.user.league_id ?? '',
      player_id: pid,
      type,
      from_squad_id: from,
      to_squad_id: to,
      effective_date: date.trim(),
      loan_end_date: kind === 'loan' ? loanEnd.trim() : null,
      reason: reason.trim() || `${type} requested`,
      requested_by: session?.user.id ?? '',
    };
    const summary = `${kind === 'add' ? 'Add' : type} ${myPlayers.find((p) => p.player_id === pid)?.name ?? pid}${to ? ` to ${to}` : ' (release)'}`;
    Alert.alert('Confirm roster change', `${summary}. This affects the squad. Continue?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: kind === 'release' ? 'destructive' : 'default',
        onPress: async () => {
          setBusy(true);
          try {
            let base = 0;
            const hk = `history:${pid}`;
            try {
              const h = await api<{ history: unknown[] }>(`/api/v1/roster/history/${encodeURIComponent(pid)}`, { timeoutMs: 4000 });
              base = h.history?.length ?? 0;
              cacheSet(hk, base);
            } catch {
              base = (await cacheGet<number>(hk))?.data ?? 0;
            }
            const res = await submitAction('roster_transfer', payload, base, summary);
            setMsg(res === 'queued'
              ? { k: 'warn', t: 'Saved as pending. It will be sent when you are back online.' }
              : { k: 'ok', t: 'Roster change accepted.' });
            if (res === 'sent') q.reload();
          } catch (e) {
            setMsg({ k: 'bad', t: friendly(e) });
          }
          setBusy(false);
        },
      },
    ]);
    void isoNow;
  };

  return (
    <Screen testID="screen-roster" loading={q.loading && !r} onRefresh={q.reload}>
      <CacheNote fromCache={q.fromCache} updatedAt={q.updatedAt} />
      {q.error && !r ? <ErrorBanner message={q.error} onRetry={q.reload} /> : null}
      {r?.transfer_window ? <Text style={T.sub}>Transfer window: {r.transfer_window.open} to {r.transfer_window.close}</Text> : null}
      <H>Action</H>
      <Chips testIDPrefix="roster-kind" value={kind} onChange={setKind} options={[{ value: 'add', label: 'Add' }, { value: 'transfer', label: 'Transfer' }, { value: 'loan', label: 'Loan' }, { value: 'release', label: 'Release' }]} />
      <H>Player</H>
      {kind === 'add' ? (
        <>
          <Field label="Player ID" testID="roster-player-id" value={manualPlayer} onChangeText={setManualPlayer} />
          <Field label="From squad ID" testID="roster-from-squad" value={fromSquad} onChangeText={setFromSquad} />
        </>
      ) : myPlayers.length === 0 ? (
        <EmptyState title="No players yet" hint="Your squads have no players to manage." />
      ) : (
        <Chips testIDPrefix="roster-player" value={playerId} onChange={setPlayerId} options={myPlayers.map((p) => ({ value: p.player_id, label: `${p.name} (${p.position})` }))} />
      )}
      {kind === 'transfer' || kind === 'loan' ? (
        <>
          {(r?.other_squads?.length ?? 0) > 0 ? (
            <>
              <H>Destination squad</H>
              <Chips testIDPrefix="roster-to" value={toSquad || null} onChange={setToSquad} options={(r?.other_squads ?? []).map((x) => ({ value: x.squad_id, label: x.name || x.squad_id }))} />
            </>
          ) : null}
          <Field label="Destination squad ID" testID="roster-to-squad" value={toSquad} onChangeText={setToSquad} />
          {squads.length > 0 ? <Text style={T.sub}>Your squads: {squads.map((s) => `${s.name} (${s.squad_id})`).join(', ')}</Text> : null}
        </>
      ) : null}
      <Field label="Effective date (YYYY-MM-DD)" testID="roster-date" value={date} onChangeText={setDate} />
      {kind === 'loan' ? <Field label="Loan end date (YYYY-MM-DD)" testID="roster-loan-end" value={loanEnd} onChangeText={setLoanEnd} /> : null}
      <Field label="Reason" testID="roster-reason" value={reason} onChangeText={setReason} autoCapitalize="sentences" />
      {msg ? <ErrorBanner kind={msg.k} message={msg.t} /> : null}
      <Button label="Submit roster change" icon="send" testID="roster-submit" onPress={submit} loading={busy} variant={kind === 'release' ? 'danger' : 'primary'} />
      <H>Current squads</H>
      {squads.map((s) => (
        <Card key={s.squad_id} testID={`squad-${s.squad_id}`}>
          <Text style={{ color: C.text, fontSize: 17, fontWeight: '800' }}>{s.name}</Text>
          {s.players.length === 0 ? <Text style={T.sub}>No players</Text> : s.players.map((p) => <Text key={p.player_id} style={T.body}>{p.name} · {p.position} · {p.role.replace('_', ' ')}</Text>)}
        </Card>
      ))}
    </Screen>
  );
}
