import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Skeleton } from './feedback';
import { C, F, S } from '@/theme';
import { useApp } from '@/state/app';

export function Screen({
  children, loading, onRefresh, testID, footer,
}: { children: React.ReactNode; loading?: boolean; onRefresh?: () => void | Promise<unknown>; testID?: string; footer?: React.ReactNode }) {
  const { primary } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      // Keep the spinner up long enough to be noticed, and until the reload finishes.
      await Promise.all([Promise.resolve(onRefresh()), new Promise((r) => setTimeout(r, 700))]);
    } catch {}
    setRefreshing(false);
  }, [onRefresh]);
  return (
    <View style={s.root} testID={testID}>
      <ScrollView
        contentContainerStyle={s.c}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={doRefresh} tintColor={primary} colors={[primary]} progressBackgroundColor={C.card} title={refreshing ? 'Refreshing…' : undefined} titleColor={C.sub} /> : undefined}
      >
        {loading ? (
          <Skeleton />
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
  h: { fontSize: 28, fontFamily: F.displayHeavy, color: C.text, letterSpacing: 0.6, textTransform: 'uppercase' },
});
