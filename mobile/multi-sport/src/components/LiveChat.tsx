import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { usePathname } from 'expo-router';
import { api, ApiError, friendly } from '@/api/client';
import { useLiveSocket, wsUrl } from '@/api/live';
import { useApp } from '@/state/app';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ErrorBanner } from '@/components/ErrorBanner';
import { C } from '@/theme';

type Msg = { seq: number; sender: string; text: string; flagged?: boolean };

/**
 * Where to send the viewer after an inline login. Logging in flips the root Stack.Protected guards, and expo-router
 * may then reset to the first available screen (Fixtures); the root layout reads this and brings the viewer back.
 */
export const returnAfterLogin: { path: string | null } = { path: null };

/**
 * Live room chat (FR-5.3): history over REST, new messages over /ws/chat/{room}. Reading is public; sending needs
 * a member login, done inline so the viewer never leaves the stream. `prefix` namespaces the testIDs
 * (costream-chat-input, match-chat-send, ...); the login fields keep the app-wide login-* ids.
 */
/** `inline` renders the messages as a plain list, for screens that already scroll (no nested virtualised list). */
export function LiveChat({ room, prefix, style, inline }: { room: string; prefix: string; style?: StyleProp<ViewStyle>; inline?: boolean }) {
  const { session, login } = useApp();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<number>());
  const pathname = usePathname();

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

  useLiveSocket(wsUrl(`/ws/chat/${encodeURIComponent(room)}`), (m) => {
    if (m.type === 'chat.message') add(m);
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
      returnAfterLogin.path = pathname;
      await login(email, password);
      setShowLogin(false);
    } catch (e) {
      returnAfterLogin.path = null;
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[{ gap: 12 }, style]}>
      {inline ? (
        <View testID={`${prefix}-chat-list`} style={[s.list, { flex: 0 }]}>
          {msgs.length ? msgs.slice(-50).map((item) => <Line key={item.seq} m={item} />) : <Text style={s.sub}>No messages yet. Say hello!</Text>}
        </View>
      ) : (
        <FlatList
          testID={`${prefix}-chat-list`}
          style={s.list}
          data={msgs}
          keyExtractor={(m) => String(m.seq)}
          renderItem={({ item }) => <Line m={item} />}
          ListEmptyComponent={<Text style={s.sub}>No messages yet. Say hello!</Text>}
        />
      )}
      {err ? <ErrorBanner message={err} /> : null}
      {session ? (
        <View style={s.compose}>
          <TextInput
            testID={`${prefix}-chat-input`}
            accessibilityLabel="Chat message"
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder="Say something"
            placeholderTextColor={C.sub}
            maxLength={500}
            onSubmitEditing={send}
          />
          <Button testID={`${prefix}-chat-send`} label="Send" icon="send" onPress={send} small />
        </View>
      ) : showLogin ? (
        <View style={{ gap: 8 }}>
          <Field label="Email" testID="login-email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" returnKeyType="next" />
          <Field label="Password" testID="login-password" value={password} onChangeText={setPassword} secureTextEntry returnKeyType="go" onSubmitEditing={signIn} />
          <Button testID="login-submit" label="Log in and chat" onPress={signIn} loading={busy} />
        </View>
      ) : (
        <Button testID={`${prefix}-login`} label="Log in to chat" icon="log-in" variant="secondary" onPress={() => setShowLogin(true)} />
      )}
    </View>
  );
}

function Line({ m }: { m: Msg }) {
  return (
    <Text style={s.msg}>
      <Text style={s.sender}>{m.sender}: </Text>
      {m.text}
    </Text>
  );
}

const s = StyleSheet.create({
  list: { flex: 1, minHeight: 160, backgroundColor: C.card, borderRadius: 12, padding: 8 },
  msg: { color: C.text, fontSize: 15, paddingVertical: 4 },
  sender: { color: C.accent, fontWeight: '700' },
  sub: { color: C.sub },
  compose: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, minHeight: 48, borderWidth: 2, borderColor: C.border, borderRadius: 10, color: C.text, paddingHorizontal: 12, fontSize: 16 },
});
