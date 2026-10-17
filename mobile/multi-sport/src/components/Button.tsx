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
  const bg = variant === 'primary' ? primary : variant === 'danger' ? C.bad : C.card;
  const fg = variant === 'secondary' ? C.text : onColor(variant === 'danger' ? C.bad : primary);
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
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.85 : 1, borderColor: variant === 'secondary' ? C.border : bg },
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
  btn: { minHeight: 52, minWidth: 48, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  txt: { fontSize: 16, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
});
