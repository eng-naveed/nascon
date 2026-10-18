import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { hlsUrl, useLiveSocket, wsUrl } from '@/api/live';
import { Card } from '@/components/Card';
import { LiveChat } from '@/components/LiveChat';
import { LivePlayer } from '@/components/LivePlayer';
import { C, F } from '@/theme';

type Session = { session_id: string; status: string; active_host: string | null; active_participants: string[]; participant_count: number; layout: string };

/**
 * Co-stream viewer (deep link nascon://stream/{id}, FR-3.3): composite video, broadcasters, and the room's
 * unified chat (chat-{id}). Session state arrives over /ws/costream/{id}; the chat has its own room socket.
 * Watching is public; chatting needs a member login, done inline so the viewer never leaves the stream.
 */
export default function CoStream() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sid = String(id ?? '');
  const [state, setState] = useState<Session | null>(null);

  useLiveSocket(wsUrl(`/ws/costream/${encodeURIComponent(sid)}`), (m) => {
    if (m.session_id) setState(m);
  });

  return (
    <View style={s.root} testID="costream-screen">
      <Stack.Screen options={{ title: 'Co-stream' }} />
      <LivePlayer uri={hlsUrl(`costream/${sid}`)} label={`Co-stream ${sid}`} testID="costream-video" />
      <Card testID="costream-state">
        <Text style={s.title}>{state?.status === 'terminated' ? 'Stream ended' : `LIVE · ${state?.participant_count ?? '…'} on air`}</Text>
        <View style={s.people}>
          {(state?.active_participants ?? []).map((p) => (
            <Text key={p} style={[s.chip, p === state?.active_host && s.host]} testID={`costream-participant-${p}`}>
              {p}
              {p === state?.active_host ? ' (host)' : ''}
            </Text>
          ))}
        </View>
      </Card>
      <LiveChat room={`chat-${sid}`} prefix="costream" style={{ flex: 1 }} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, padding: 16, gap: 12 },
  title: { color: C.text, fontSize: 20, fontFamily: F.displayHeavy },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { color: C.text, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  host: { borderColor: C.accent, color: C.accent },
});
