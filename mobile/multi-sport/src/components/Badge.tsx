import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/theme';

const KINDS = {
  ok: { fg: C.ok, bg: C.okBg },
  warn: { fg: C.warn, bg: C.warnBg },
  bad: { fg: C.bad, bg: C.badBg },
  info: { fg: C.info, bg: C.infoBg },
};
export function Badge({
  text, kind = 'info', icon,
}: { text: string; kind?: keyof typeof KINDS; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const k = KINDS[kind];
  return (
    <View style={[s.b, { backgroundColor: k.bg }]} accessible accessibilityLabel={text}>
      {icon ? <Ionicons name={icon} size={14} color={k.fg} /> : null}
      <Text style={[s.t, { color: k.fg }]}>{text}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  b: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
  t: { fontSize: 13, fontWeight: '700' },
});
