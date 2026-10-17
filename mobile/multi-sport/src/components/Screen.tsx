import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, F, S } from '@/theme';
import { useApp } from '@/state/app';

export function Screen({
  children, loading, onRefresh, testID, footer,
}: { children: React.ReactNode; loading?: boolean; onRefresh?: () => void; testID?: string; footer?: React.ReactNode }) {
  const { primary } = useApp();
  return (
    <View style={s.root} testID={testID}>
      <ScrollView
        contentContainerStyle={s.c}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} /> : undefined}
      >
        {loading ? (
          <View style={s.load} testID="loading-indicator" accessible accessibilityLabel="Loading">
            <ActivityIndicator size="large" color={primary} />
            <Text style={s.lt}>Loading…</Text>
          </View>
        ) : (
          children
        )}
      </ScrollView>
      {footer}
    </View>
  );
}
export function H({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.h}>
      {children}
    </Text>
  );
}
export const T = {
  body: { fontSize: 16, color: C.text } as const,
  sub: { fontSize: 14, color: C.sub } as const,
};
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  c: { padding: S.lg, gap: S.md, paddingBottom: 120 },
  load: { padding: 40, alignItems: 'center', gap: 8 },
  lt: { fontSize: 16, color: C.sub },
  h: { fontSize: 28, fontFamily: F.displayHeavy, color: C.text, letterSpacing: 0.6, textTransform: 'uppercase' },
});
