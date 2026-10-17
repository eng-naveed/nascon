import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { friendly } from '@/api/client';
import { useApp } from '@/state/app';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Chips } from '@/components/Chips';
import { C, F, onColor } from '@/theme';

const DEMOS = [
  { value: 'admin@nascon.test', label: 'Admin' },
  { value: 'organizer@nascon.test', label: 'Organizer' },
  { value: 'manager@nascon.test', label: 'Manager' },
  { value: 'player@nascon.test', label: 'Player' },
  { value: 'viewer@nascon.test', label: 'Viewer' },
];

export default function Login() {
  const { login, online, serverUrl, primary } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setErr('Please enter your email and password.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
    } catch (e) {
      setErr(friendly(e));
    }
    setBusy(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.c} keyboardShouldPersistTaps="handled">
          <View style={s.ring}><View style={[s.logo, { backgroundColor: primary }]}>
            <Ionicons name="trophy" size={40} color={onColor(primary)} />
          </View></View>
          <Text style={s.title} accessibilityRole="header">NaSCon League</Text>
          <Text style={s.sub}>Sign in to follow fixtures, standings and your club.</Text>
          {!online ? <ErrorBanner kind="warn" message="You are offline. Connect to the internet or check the server address to sign in." /> : null}
          <Field label="Email" testID="login-email" value={email} onChangeText={setEmail} keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" />
          <Field label="Password" testID="login-password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" onSubmitEditing={submit} />
          {err ? <ErrorBanner message={err} /> : null}
          <Button label="Sign in" icon="log-in" testID="login-submit" onPress={submit} loading={busy} />
          <Text style={s.lbl}>Quick fill a demo account (password Nascon@26)</Text>
          <Chips testIDPrefix="demo" value={email} onChange={(v) => { setEmail(v); setPassword('Nascon@26'); }} options={DEMOS} />
          <Button label={`Server: ${serverUrl}`} icon="server" variant="secondary" testID="login-server-settings" onPress={() => router.push('/settings')} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  c: { padding: 20, gap: 14 },
  ring: { alignSelf: 'center', width: 104, height: 104, borderRadius: 52, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  logo: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 44, fontFamily: F.displayHeavy, color: C.text, textAlign: 'center', letterSpacing: 2, textTransform: 'uppercase' },
  sub: { fontSize: 15, color: C.sub, textAlign: 'center', marginBottom: 8 },
  lbl: { fontSize: 13, color: C.sub, fontWeight: '700', marginTop: 8 },
});
