import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { api, ApiError, friendly } from '@/api/client';
import { hlsUrl, useLiveSocket, wsUrl } from '@/api/live';
import { useApp } from '@/state/app';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ErrorBanner } from '@/components/ErrorBanner';
import { LivePlayer } from '@/components/LivePlayer';
import { C, F } from '@/theme';

type Msg = { seq: number; sender: string; text: string; flagged?: boolean };
type Session = { session_id: string; status: string; active_host: string | null; active_participants: string[]; participant_count: number; layout: string };

/**
 * Co-stream viewer (deep link nascon://stream/{id}, FR-3.3): composite video, broadcasters, and the room's
 * unified chat (chat-{id}) live over one WebSocket. Watching is public; chatting needs a member login,
 * done inline so the viewer never leaves the stream.
 */
export default function CoStream() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sid = String(id ?? '');
  const room = `chat-${sid}`;
  const { session, login } = useApp();
  const [state, setState] = useState<Session | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<number>());

  const add = useCallback((m: Msg) => {
    if (seen.current.has(m.seq)) return;
    seen.current.add(m.seq);
    setMsgs((cur) => [...cur, m].sort((a, b) => a.seq - b.seq).slice(-200));
  }, []);

  useEffect(() => {
    api<{ messages: Msg[] }>(`/api/v1/chat/${encodeURIComponent(room)}/messages?limit=100`, { auth: false })
      .then((r) => r.messages.forEach(add))
      .catch(() => undefined);
  }, [room, add]);

  useLiveSocket(wsUrl(`/ws/costream/${encodeURIComponent(sid)}`), (m) => {
    if (m.type === 'chat.message') add(m);
    else if (m.session_id) setState(m);
  });

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setErr(null);
    try {
      await api('/api/v1/chat', { body: { chat_room_id: room, text: t } });
      setText('');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.code === 'GUEST_WRITE_FORBIDDEN')) setShowLogin(true);
      else setErr(friendly(e));
    }
  };

  const signIn = async () => {
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
      setShowLogin(false);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

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
      <FlatList
        testID="costream-chat-list"
        style={s.list}
        data={msgs}
        keyExtractor={(m) => String(m.seq)}
        renderItem={({ item }) => (
          <Text style={s.msg}>
            <Text style={s.sender}>{item.sender}: </Text>
            {item.text}
          </Text>
        )}
        ListEmptyComponent={<Text style={s.sub}>No messages yet. Say hello!</Text>}
      />
      {err ? <ErrorBanner message={err} /> : null}
      {session ? (
        <View style={s.compose}>
          <TextInput
            testID="costream-chat-input"
            accessibilityLabel="Chat message"
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder="Say something"
            placeholderTextColor={C.sub}
            maxLength={500}
            onSubmitEditing={send}
          />
          <Button testID="costream-chat-send" label="Send" icon="send" onPress={send} small />
        </View>
      ) : showLogin ? (
        <View style={{ gap: 8 }}>
          <Field label="Email" testID="login-email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Password" testID="login-password" value={password} onChangeText={setPassword} secureTextEntry />
          <Button testID="login-submit" label="Log in and chat" onPress={signIn} loading={busy} />
        </View>
      ) : (
        <Button testID="costream-login" label="Log in to chat" icon="log-in" variant="secondary" onPress={() => setShowLogin(true)} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, padding: 16, gap: 12 },
  title: { color: C.text, fontSize: 20, fontFamily: F.displayHeavy },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { color: C.text, borderWidth: 1, borderColor: C.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  host: { borderColor: C.accent, color: C.accent },
  list: { flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 8 },
  msg: { color: C.text, fontSize: 15, paddingVertical: 4 },
  sender: { color: C.accent, fontWeight: '700' },
  sub: { color: C.sub },
  compose: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, minHeight: 48, borderWidth: 2, borderColor: C.border, borderRadius: 10, color: C.text, paddingHorizontal: 12, fontSize: 16 },
});
