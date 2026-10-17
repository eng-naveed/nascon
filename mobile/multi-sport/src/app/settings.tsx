import React, { useState } from 'react';
import { Alert, Text } from 'react-native';
import { router } from 'expo-router';
import { DEFAULT_URL, getBaseUrl, ping, saveServerUrl } from '@/api/client';
import { useApp } from '@/state/app';
import { Screen, H, T } from '@/components/Screen';
import { Field } from '@/components/Field';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Card } from '@/components/Card';

export default function Settings() {
  const { session, logout, refreshServerUrl, queue } = useApp();
  const [url, setUrl] = useState(getBaseUrl());
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad'; t: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await saveServerUrl(url);
    refreshServerUrl();
    const ok = await ping();
    setMsg(ok ? { k: 'ok', t: 'Saved. The server is reachable.' } : { k: 'bad', t: 'Saved, but the server could not be reached. Check the address and that the server is running.' });
    setUrl(getBaseUrl());
    setBusy(false);
  };
  const doLogout = () => {
    Alert.alert(
      'Sign out?',
      queue.length ? `You have ${queue.length} pending action(s). They stay saved and will sync after you sign in again.` : 'You will need to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: async () => { await logout(); router.dismissAll?.(); } },
      ],
    );
  };
  return (
    <Screen testID="screen-settings">
      <H>Server address</H>
      <Text style={T.sub}>Emulator: http://10.0.2.2:8080. Physical phone: your laptop's LAN IP, e.g. http://192.168.1.20:8080.</Text>
      <Field label="Server URL" testID="settings-server-url" value={url} onChangeText={setUrl} keyboardType="url" placeholder={DEFAULT_URL} />
      {msg ? <ErrorBanner kind={msg.k} message={msg.t} /> : null}
      <Button label="Save and test connection" icon="save" testID="settings-save" onPress={save} loading={busy} />
      <Button label="Reset to default" variant="secondary" icon="refresh" testID="settings-reset" onPress={() => setUrl(DEFAULT_URL)} />
      {session ? (
        <>
          <H>Account</H>
          <Card>
            <Text style={T.body}>{session.user.name}</Text>
            <Text style={T.sub}>{session.user.email}</Text>
            <Text style={T.sub}>Role: {session.user.role.replace('_', ' ')}</Text>
          </Card>
          <Button label="Sign out" variant="danger" icon="log-out" testID="settings-logout" onPress={doLogout} />
        </>
      ) : null}
    </Screen>
  );
}
