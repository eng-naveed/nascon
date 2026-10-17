import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useApp } from '@/state/app';
import { C } from '@/theme';

export function SyncBar() {
  const { online, syncing, queue } = useApp();
  const state = syncing ? 'syncing' : online ? 'online' : 'offline';
  const cfg = {
    online: { t: 'Online', icon: 'cloud-done', bg: C.okBg, fg: C.ok },
    offline: { t: 'Offline', icon: 'cloud-offline', bg: C.warnBg, fg: C.warn },
    syncing: { t: 'Syncing…', icon: 'sync', bg: C.infoBg, fg: C.info },
  }[state] as { t: string; icon: any; bg: string; fg: string };
  const pending = queue.length;
  const label = `${cfg.t}. ${pending} pending ${pending === 1 ? 'action' : 'actions'}. Open sync status.`;
  return (
    <Pressable
      testID="sync-bar"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push('/sync')}
      style={[s.bar, { backgroundColor: cfg.bg }]}
    >
      <View style={s.row}>
        <Ionicons name={cfg.icon} size={20} color={cfg.fg} />
        <Text testID="sync-status-text" style={[s.t, { color: cfg.fg }]}>
          {cfg.t}
        </Text>
      </View>
      <Text testID="sync-pending-count" style={[s.t, { color: cfg.fg }]}>
        {pending} pending
      </Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  bar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  t: { fontSize: 15, fontWeight: '700' },
});
