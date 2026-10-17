import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { F, teamColor } from '@/theme';

/** Round club crest placeholder: initials on a tinted disc (colour derived from the team id). */
export function TeamMark({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  const col = teamColor(id);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[s.d, { width: size, height: size, borderRadius: size / 2, backgroundColor: col + '33', borderColor: col }]}
    >
      <Text style={{ color: col, fontFamily: F.displayHeavy, fontSize: size * 0.42 }}>{initials}</Text>
    </View>
  );
}
const s = StyleSheet.create({ d: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 } });
