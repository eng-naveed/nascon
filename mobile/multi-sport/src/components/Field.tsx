import React from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { C } from '@/theme';

export function Field({ label, testID, ...p }: TextInputProps & { label: string; testID: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.l}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor="#8593B3"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardAppearance="dark"
        {...p}
        style={s.i}
      />
    </View>
  );
}
const s = StyleSheet.create({
  l: { fontSize: 13, fontWeight: '800', color: C.sub, letterSpacing: 0.6, textTransform: 'uppercase' },
  i: { minHeight: 54, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, fontSize: 16, color: C.text, backgroundColor: C.card2 },
});
