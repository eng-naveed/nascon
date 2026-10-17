import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C, onColor } from '@/theme';
import { useApp } from '@/state/app';

export function Chips<T extends string>({
  options, value, onChange, testIDPrefix,
}: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; testIDPrefix: string }) {
  const { primary } = useApp();
  return (
    <View style={s.row}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={`${testIDPrefix}-${o.value}`}
            accessibilityLabel={o.label}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [
              s.chip,
              on ? { backgroundColor: primary, borderColor: primary } : { backgroundColor: C.card2, borderColor: C.border },
              pressed && { transform: [{ scale: 0.96 }] },
            ]}
          >
            <Text style={[s.t, { color: on ? onColor(primary) : C.text }]}>{on ? '✓ ' : ''}{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, minWidth: 48, paddingHorizontal: 16, borderRadius: 24, borderWidth: 1.5, justifyContent: 'center' },
  t: { fontSize: 15, fontWeight: '700' },
});
