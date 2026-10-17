import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { C, R } from '@/theme';

export function Card({
  children, onPress, testID, label, style,
}: { children: React.ReactNode; onPress?: () => void; testID?: string; label?: string; style?: ViewStyle }) {
  if (onPress)
    return (
      <Pressable
        testID={testID}
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]}
      >
        {children}
      </Pressable>
    );
  return (
    <View testID={testID} style={[s.card, style]}>
      {children}
    </View>
  );
}
const s = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: R, padding: 14, borderWidth: 1, borderColor: C.border, minHeight: 48 },
});
