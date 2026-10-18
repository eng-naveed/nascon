import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useApp } from '@/state/app';
import { C } from '@/theme';

function useSyncState() {
  const { online, syncing, queue } = useApp();
  const state = syncing ? 'syncing' : online ? 'online' : 'offline';
  const cfg = {
    online: { t: 'Online', icon: 'cloud-done', bg: C.okBg, fg: C.ok },
    offline: { t: 'Offline', icon: 'cloud-offline', bg: C.warnBg, fg: C.warn },
    syncing: { t: 'Syncing…', icon: 'sync', bg: C.infoBg, fg: C.info },
  }[state] as { t: string; icon: any; bg: string; fg: string };
  const pending = queue.length;
  const label = `${cfg.t}. ${pending} pending ${pending === 1 ? 'action' : 'actions'}. Open sync status.`;
  return { state, cfg, pending, label };
}

/** Always-visible, compact status pill for the header (dot + status + pending count). */
/** `compact` drops the word and keeps the icon (and pending count): for crowded headers such as the tab bar's. */
export function SyncPill({ compact }: { compact?: boolean } = {}) {
  const { cfg, pending, label } = useSyncState();
  return (
    <Pressable testID="sync-bar" accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push('/sync')} hitSlop={8} style={[s.pill, { backgroundColor: cfg.bg }, compact && { paddingHorizontal: 8 }]}>
      <Ionicons name={cfg.icon} size={compact ? 18 : 15} color={cfg.fg} />
      {compact ? null : (
        <Text testID="sync-status-text" style={[s.pt, { color: cfg.fg }]}>
          {cfg.t}
        </Text>
      )}
      {pending > 0 ? (
        <View style={[s.count, { backgroundColor: cfg.fg }]}>
          <Text testID="sync-pending-count" style={s.countT}>
            {pending}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Full-width banner at the bottom, shown only when the user needs to know something. */
export function SyncBanner() {
  const { state, cfg, pending } = useSyncState();
  // Online with nothing pending, or offline with nothing to sync (the header pill and the saved-data note already say so): stay quiet.
  if (pending === 0 && state !== 'syncing') return null;
  const msg =
    state === 'offline'
      ? pending > 0
        ? `You are offline. ${pending} ${pending === 1 ? 'action is' : 'actions are'} saved and will sync when you reconnect.`
        : 'You are offline. Saved information is shown and changes will wait until you reconnect.'
      : state === 'syncing'
        ? 'Syncing your saved actions…'
        : `${pending} ${pending === 1 ? 'action is' : 'actions are'} waiting to sync.`;
  return (
    <Pressable testID="sync-banner" accessibilityRole="button" accessibilityLabel={`${msg} Open sync status.`} onPress={() => router.push('/sync')} style={[s.bar, { backgroundColor: cfg.bg, borderTopColor: cfg.fg }]}>
      <Ionicons name={cfg.icon} size={20} color={cfg.fg} />
      <Text style={[s.bt, { color: cfg.fg }]}>{msg}</Text>
      <Ionicons name="chevron-forward" size={18} color={cfg.fg} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 999 },
  pt: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  count: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countT: { fontSize: 11, fontWeight: '900', color: C.bg },
  bar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 2 },
  bt: { flex: 1, fontSize: 13, fontWeight: '700' },
});
