import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, onColor } from '@/theme';
import { useApp } from '@/state/app';

type Props = {
  label: string;
  onPress: () => void;
  testID: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
};
export function Button({ label, onPress, testID, icon, variant = 'primary', loading, disabled, small }: Props) {
  const { primary } = useApp();
  const bg = variant === 'primary' ? primary : variant === 'danger' ? C.live : C.card2;
  const fg = variant === 'secondary' ? C.text : onColor(variant === 'danger' ? C.live : primary);
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        s.btn,
        {
          backgroundColor: bg, opacity: off ? 0.5 : 1, borderColor: variant === 'secondary' ? C.border : bg,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        variant === 'primary' && { shadowColor: primary, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
        small && { minHeight: 48, paddingHorizontal: 12 },
      ]}
    >
      <View style={s.row}>
        {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
        <Text style={[s.txt, { color: fg }]} numberOfLines={2}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
const s = StyleSheet.create({
  btn: { minHeight: 54, minWidth: 48, borderRadius: 16, paddingHorizontal: 18, justifyContent: 'center', borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  txt: { fontSize: 16, fontWeight: '800', textAlign: 'center', flexShrink: 1, letterSpacing: 0.3 },
});
