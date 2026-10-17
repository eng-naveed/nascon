import React from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { C } from '@/theme';

export function Field({ label, testID, ...p }: TextInputProps & { label: string; testID: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.l}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor="#6B7280"
        autoCapitalize="none"
        autoCorrect={false}
        {...p}
        style={s.i}
      />
    </View>
  );
}
const s = StyleSheet.create({
  l: { fontSize: 14, fontWeight: '700', color: C.text },
  i: { minHeight: 52, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, fontSize: 16, color: C.text, backgroundColor: '#fff' },
});
