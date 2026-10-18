import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { api, friendly } from '@/api/client';
import { forDevice, publishPageUrl } from '@/api/live';
import { useApp } from '@/state/app';
import { Screen, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { C } from '@/theme';

type Key = { stream_key: string; status: string; ingest_endpoints: { rtmp: string; webrtc: string } | null; playback_url: string | null };

/**
 * Solo broadcasting (FR-3.2): issue / rotate / revoke a stream key, show OBS ingest URLs, or go live from
 * this phone over WebRTC (WHIP) through the media server's publish page. Revoking cuts the stream in < 2 s.
 */
export default function GoLive() {
  const { session } = useApp();
  const playerId = session?.user.player_id;
  const [key, setKey] = useState<Key | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cam, askCam] = useCameraPermissions();
  const [mic, askMic] = useMicrophonePermissions();

  const act = async (action: 'generate' | 'rotate' | 'revoke') => {
    if (!playerId) return;
    setBusy(true);
    setErr(null);
    try {
      const k = await api<Key>('/audit/v1/stream/key', { body: { action, player_id: playerId, label: 'In-app' }, auth: false });
      setKey(k);
      if (action !== 'generate') setLive(false);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const goLive = async () => {
    if (!cam?.granted) await askCam();
    if (!mic?.granted) await askMic();
    setLive(true);
  };

  if (!playerId)
    return (
      <Screen testID="screen-golive">
        <Card>
          <Text style={T.body}>Broadcasting is for athletes. Log in with a player account to go live.</Text>
        </Card>
      </Screen>
    );

  const active = key?.status === 'active' && key.ingest_endpoints;
  return (
    <Screen testID="screen-golive">
      <Stack.Screen options={{ title: 'Go live' }} />
      {err ? <ErrorBanner message={err} /> : null}
      {live && active ? (
        <View style={s.preview} testID="golive-broadcaster">
          <WebView
            source={{ uri: publishPageUrl(key!.stream_key) }}
            mediaCapturePermissionGrantType="grant"
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
          />
        </View>
      ) : null}
      <Card testID="golive-key">
        {active ? (
          <View style={{ gap: 6 }}>
            <Text style={s.label}>Stream key</Text>
            <Text style={s.mono} selectable testID="golive-stream-key">{key!.stream_key}</Text>
            <Text style={s.label}>OBS / FFmpeg (RTMP)</Text>
            <Text style={s.mono} selectable>{forDevice(key!.ingest_endpoints!.rtmp)}</Text>
            <Text style={s.label}>WebRTC (WHIP)</Text>
            <Text style={s.mono} selectable>{forDevice(key!.ingest_endpoints!.webrtc)}</Text>
            <Text style={s.label}>Viewers (HLS)</Text>
            <Text style={s.mono} selectable>{forDevice(key!.playback_url!)}</Text>
          </View>
        ) : (
          <Text style={T.body}>{key?.status === 'revoked' ? 'Key revoked: the stream was cut.' : 'Create a stream key to go live from this phone or from OBS.'}</Text>
        )}
      </Card>
      {!active ? (
        <Button testID="golive-generate" label="Create stream key" icon="key" onPress={() => act('generate')} loading={busy} />
      ) : (
        <View style={{ gap: 8 }}>
          {!live ? <Button testID="golive-start" label="Broadcast from this phone" icon="radio" onPress={goLive} /> : null}
          <Button testID="golive-rotate" label="Rotate key" icon="refresh" variant="secondary" onPress={() => act('rotate')} loading={busy} />
          <Button testID="golive-revoke" label="Stop and revoke key" icon="stop-circle" variant="danger" onPress={() => act('revoke')} loading={busy} />
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  preview: { width: '100%', aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  label: { color: C.sub, fontSize: 13 },
  mono: { color: C.text, fontFamily: 'monospace', fontSize: 13 },
});
