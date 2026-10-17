import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/theme';

export function EmptyState({
  title, hint, icon = 'file-tray-outline', testID = 'empty-state',
}: { title: string; hint?: string; icon?: React.ComponentProps<typeof Ionicons>['name']; testID?: string }) {
  return (
    <View style={s.w} testID={testID} accessible accessibilityLabel={`${title}. ${hint ?? ''}`}>
      <Ionicons name={icon} size={40} color={C.sub} />
      <Text style={s.t}>{title}</Text>
      {hint ? <Text style={s.h}>{hint}</Text> : null}
    </View>
  );
}
const s = StyleSheet.create({
  w: { alignItems: 'center', padding: 24, gap: 8 },
  t: { fontSize: 18, fontWeight: '700', color: C.text, textAlign: 'center' },
  h: { fontSize: 15, color: C.sub, textAlign: 'center' },
});
