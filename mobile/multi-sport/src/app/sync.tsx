import { C, F } from '@/theme';
import { Ionicons } from '@expo/vector-icons';

function fmtHM(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
import React from 'react';
import { Alert, Text, View } from 'react-native';
import { friendlyCode } from '@/api/client';
import { useApp } from '@/state/app';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function SyncScreen() {
  const { online, syncing, queue, results, sync, lastSyncMsg, clearResults } = useApp();
  // Latest sync = the newest batch of results (all rows of one sync share the same timestamp).
  const lastAt = results.reduce<string | null>((a, r) => (!a || r.at > a ? r.at : a), null);
  const latest = results.filter((r) => r.at === lastAt);
  const counts = {
    applied: latest.filter((r) => r.status === 'applied').length,
    rejected: latest.filter((r) => r.status === 'rejected').length,
    duplicate: latest.filter((r) => r.status === 'duplicate').length,
  };
  return (
    <Screen testID="screen-sync">
      <Card testID="sync-summary">
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{syncing ? 'Syncing…' : online ? 'Online' : 'Offline'}</Text>
        <Text style={T.sub}>{online ? 'Connected to the server.' : 'No connection. Actions you make are saved on this device and sent later.'}</Text>
      </Card>
      {lastSyncMsg ? <ErrorBanner kind="ok" message={lastSyncMsg} /> : null}
      {lastAt ? (
        <Card testID="sync-last-summary">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="time-outline" size={18} color={C.sub} />
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }} testID="sync-last-time">Last synced {fmtHM(lastAt)}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            {[
              { n: counts.applied, t: 'Applied', fg: C.ok, bg: C.okBg, icon: 'checkmark-circle' as const },
              { n: counts.rejected, t: 'Rejected', fg: C.bad, bg: C.badBg, icon: 'close-circle' as const },
              { n: counts.duplicate, t: 'Already recorded', fg: C.info, bg: C.infoBg, icon: 'copy' as const },
            ].map((x) => (
              <View key={x.t} style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, backgroundColor: x.bg }} accessible accessibilityLabel={`${x.n} ${x.t}`} testID={`sync-count-${x.t.split(' ')[0].toLowerCase()}`}>
                <Text style={{ fontSize: 28, fontFamily: F.displayHeavy, color: x.fg }}>{x.n}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Ionicons name={x.icon} size={13} color={x.fg} />
                  <Text style={{ fontSize: 12, fontWeight: '800', color: x.fg, textAlign: 'center', flexShrink: 1 }}>{x.t}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <Button
        label={syncing ? 'Syncing…' : 'Sync now'}
        icon="sync"
        testID="sync-now"
        loading={syncing}
        onPress={() => {
          if (!online) return Alert.alert('Offline', 'You are offline. Your actions will sync automatically when the connection returns.');
          sync();
        }}
      />
      <H>Pending actions ({queue.length})</H>
      {queue.length === 0 ? <EmptyState title="Nothing pending" hint="Actions made while offline will wait here." icon="checkmark-done-outline" /> : null}
      {queue.map((q) => (
        <Card key={q.action_id} testID={`pending-${q.action_id}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <Badge kind="warn" icon="time" text="Pending" />
            <Text style={T.sub}>{q.type === 'score_event' ? 'Score' : 'Roster'}</Text>
          </View>
          <Text style={T.body}>{q.summary}</Text>
          <Text style={T.sub}>Saved {new Date(q.queued_at).toLocaleString()}</Text>
        </Card>
      ))}
      <H>Results</H>
      {results.length === 0 ? <EmptyState title="No results yet" hint="After a sync, each action shows whether it was applied or rejected." icon="list-outline" /> : null}
      {results.map((r) => (
        <Card key={r.action_id} testID={`result-${r.action_id}`}>
          {r.status === 'applied' ? <Badge kind="ok" icon="checkmark-circle" text="Applied" /> : r.status === 'duplicate' ? <Badge kind="info" icon="copy" text="Already recorded" /> : <Badge kind="bad" icon="close-circle" text="Rejected" />}
          <Text style={T.body}>{r.summary}</Text>
          {r.status === 'rejected' ? <Text style={T.sub}>Reason: {friendlyCode(r.error_code)} The server's version was kept.</Text> : null}
          {r.status === 'duplicate' ? <Text style={T.sub}>The server already had this action, so nothing changed.</Text> : null}
          {r.status === 'applied' && r.resolution === 'rebased_append' ? <Text style={T.sub}>Applied after newer changes on the server.</Text> : null}
        </Card>
      ))}
      {results.length > 0 ? <Button label="Clear results" variant="secondary" icon="trash" testID="sync-clear-results" onPress={clearResults} /> : null}
    </Screen>
  );
}
