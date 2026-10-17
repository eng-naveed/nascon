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
  return (
    <Screen testID="screen-sync">
      <Card testID="sync-summary">
        <Text style={{ fontSize: 20, fontWeight: '800' }}>{syncing ? 'Syncing…' : online ? 'Online' : 'Offline'}</Text>
        <Text style={T.sub}>{online ? 'Connected to the server.' : 'No connection. Actions you make are saved on this device and sent later.'}</Text>
      </Card>
      {lastSyncMsg ? <ErrorBanner kind="ok" message={lastSyncMsg} /> : null}
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
          {r.status === 'applied' ? <Badge kind="ok" icon="checkmark-circle" text="Applied" /> : r.status === 'duplicate' ? <Badge kind="info" icon="copy" text="Already done" /> : <Badge kind="bad" icon="close-circle" text="Rejected" />}
          <Text style={T.body}>{r.summary}</Text>
          {r.status === 'rejected' ? <Text style={T.sub}>Reason: {friendlyCode(r.error_code)} The server's version was kept.</Text> : null}
          {r.status === 'applied' && r.resolution === 'rebased_append' ? <Text style={T.sub}>Applied after newer changes on the server.</Text> : null}
        </Card>
      ))}
      {results.length > 0 ? <Button label="Clear results" variant="secondary" icon="trash" testID="sync-clear-results" onPress={clearResults} /> : null}
    </Screen>
  );
}
