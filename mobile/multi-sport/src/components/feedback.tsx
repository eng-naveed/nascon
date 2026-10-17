import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View, type TextStyle, type StyleProp } from 'react-native';
import * as Haptics from 'expo-haptics';
import { C, R } from '@/theme';

/** Light haptic feedback; never throws (no-op where unsupported). */
export function haptic(kind: 'success' | 'error' | 'warning' | 'light') {
  try {
    const p =
      kind === 'light'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Haptics.notificationAsync(
            kind === 'success'
              ? Haptics.NotificationFeedbackType.Success
              : kind === 'error'
                ? Haptics.NotificationFeedbackType.Error
                : Haptics.NotificationFeedbackType.Warning,
          );
    p?.catch?.(() => {});
  } catch {}
}

export function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

/** Pulsing placeholder cards shown while content loads (static when Reduce Motion is on). */
export function Skeleton({ rows = 3, height = 120, testID = 'loading-indicator', label = 'Loading' }: { rows?: number; height?: number; testID?: string; label?: string }) {
  const reduce = useReduceMotion();
  const [o] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.55, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, o]);
  return (
    <View testID={testID} accessible accessibilityRole="progressbar" accessibilityLabel={label} style={{ gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Animated.View key={i} style={[s.card, { height, opacity: o }]}>
          <View style={[s.bar, { width: '35%' }]} />
          <View style={[s.bar, { width: '80%', height: 18 }]} />
          <View style={[s.bar, { width: '55%' }]} />
        </Animated.View>
      ))}
    </View>
  );
}

/** Score text that briefly "pops" (scale) whenever its value changes. */
export function ScorePop({ value, style, testID, accessibilityLabel }: { value: string; style?: StyleProp<TextStyle>; testID?: string; accessibilityLabel?: string }) {
  const reduce = useReduceMotion();
  const [sc] = useState(() => new Animated.Value(1));
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    if (reduce) return;
    sc.setValue(1);
    Animated.sequence([
      Animated.timing(sc, { toValue: 1.25, duration: 160, useNativeDriver: true }),
      Animated.spring(sc, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [value, reduce, sc]);
  return (
    <Animated.Text testID={testID} accessibilityLabel={accessibilityLabel} style={[style, { transform: [{ scale: sc }] }]}>
      {value}
    </Animated.Text>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: R, borderWidth: 1, borderColor: C.border, padding: 16, gap: 12, justifyContent: 'center' },
  bar: { height: 12, borderRadius: 6, backgroundColor: C.card2 },
});
