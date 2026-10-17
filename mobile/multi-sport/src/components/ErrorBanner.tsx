import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/theme';
import { Button } from './Button';

export function ErrorBanner({ message, onRetry, kind = 'bad' }: { message: string; onRetry?: () => void; kind?: 'bad' | 'ok' | 'warn' }) {
  const col = kind === 'ok' ? [C.ok, C.okBg] : kind === 'warn' ? [C.warn, C.warnBg] : [C.bad, C.badBg];
  const icon = kind === 'ok' ? 'checkmark-circle' : kind === 'warn' ? 'warning' : 'alert-circle';
  return (
    <View style={[s.w, { backgroundColor: col[1], borderColor: col[0] }]} testID={`banner-${kind}`} accessibilityRole="alert" accessible accessibilityLabel={message}>
      <View style={s.row}>
        <Ionicons name={icon} size={22} color={col[0]} />
        <Text style={[s.t, { color: col[0] }]}>{message}</Text>
      </View>
      {onRetry ? <Button label="Try again" icon="refresh" variant="secondary" small onPress={onRetry} testID="retry-button" /> : null}
    </View>
  );
}
const s = StyleSheet.create({
  w: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  t: { flex: 1, fontSize: 15, fontWeight: '600' },
});
