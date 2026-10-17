import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/theme';

const KINDS = {
  ok: { fg: C.ok, bg: C.okBg },
  warn: { fg: C.warn, bg: C.warnBg },
  bad: { fg: C.bad, bg: C.badBg },
  info: { fg: C.info, bg: C.infoBg },
  live: { fg: '#FFFFFF', bg: C.live },
};
export function Badge({
  text, kind = 'info', icon,
}: { text: string; kind?: keyof typeof KINDS; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const k = KINDS[kind];
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (kind !== 'live') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [kind, pulse]);
  return (
    <View style={[s.b, { backgroundColor: k.bg }]} accessible accessibilityLabel={text}>
      {kind === 'live' ? (
        <Animated.View style={[s.dot, { opacity: pulse }]} />
      ) : icon ? (
        <Ionicons name={icon} size={14} color={k.fg} />
      ) : null}
      <Text style={[s.t, { color: k.fg }]}>{text.toUpperCase()}</Text>
    </View>
  );
}
const s = StyleSheet.create({
  b: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, alignSelf: 'flex-start' },
  t: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
});
