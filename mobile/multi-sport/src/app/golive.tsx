import React, { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { api, friendly, getBaseUrl } from '@/api/client';
import { forDevice } from '@/api/live';
import { whipPublisherHtml } from '@/features/broadcast/whipPage';
import { useApp } from '@/state/app';
import { Screen, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { LiveChat } from '@/components/LiveChat';
import { C } from '@/theme';

type Key = { stream_key: string; status: string; ingest_endpoints: { rtmp: string; webrtc: string } | null; playback_url: string | null };

/**
 * Solo broadcasting (FR-3.2): issue / rotate / revoke a stream key, show OBS ingest URLs, or go live from
 * this phone over WebRTC (WHIP) from an in-app publisher page. Revoking cuts the stream in < 2 s.
 */
export default function GoLive() {
  const { session } = useApp();
  const playerId = session?.user.player_id;
  const [key, setKey] = useState<Key | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const web = useRef<React.ComponentRef<typeof WebView>>(null);
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
  const control = (js: string) => web.current?.injectJavaScript(`${js};true;`);
  const onWebMessage = (raw: string) => {
    try {
      const m = JSON.parse(raw);
      if (typeof m.muted === 'boolean') setMuted(m.muted);
      if (m.text) setStatus(m.text);
    } catch {}
  };
  return (
    <Screen testID="screen-golive">
      <Stack.Screen options={{ title: 'Go live' }} />
      {err ? <ErrorBanner message={err} /> : null}
      {live && active ? (
        <View style={s.preview} testID="golive-broadcaster">
          <WebView
            // inline page on a localhost base URL = secure context, so the camera works (see whipPage.ts)
            source={{ html: whipPublisherHtml(forDevice(key!.ingest_endpoints!.webrtc)), baseUrl: 'http://localhost' }}
            originWhitelist={['*']}
            mediaCapturePermissionGrantType="grant"
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            ref={web}
            onMessage={(e: WebViewMessageEvent) => onWebMessage(e.nativeEvent.data)}
          />
        </View>
      ) : null}
      {live && active ? (
        <View style={s.controls} testID="golive-controls">
          <Ctl icon="camera-reverse" label="Flip" testID="golive-flip" onPress={() => control('window.__flip&&window.__flip()')} />
          <Ctl icon={muted ? 'mic-off' : 'mic'} label={muted ? 'Unmute' : 'Mute'} testID="golive-mute" onPress={() => control(`window.__mute&&window.__mute(${!muted})`)} active={muted} />
          <Ctl icon="qr-code" label="Share" testID="golive-share" onPress={() => setShowQr((v) => !v)} active={showQr} />
          <Ctl icon="stop-circle" label="End" testID="golive-end" danger onPress={() => act('revoke')} />
        </View>
      ) : null}
      {live && active && status ? <Text style={s.status} testID="golive-status">{status}</Text> : null}
      {active && showQr ? (
        <Card testID="golive-qr">
          <View style={{ alignItems: 'center', gap: 8 }}>
            <Text style={s.label}>Viewers scan this in the NaSCon app (Scan QR) to watch and chat</Text>
            <View style={s.qrBox}>
              <Image source={{ uri: `${getBaseUrl()}/audit/v1/qr/${encodeURIComponent(playerId)}/export.png` }} style={{ width: 220, height: 220 }} accessibilityLabel="QR code to join this live stream" />
            </View>
            <Text style={s.mono} selectable>nascon://entity/{playerId}</Text>
          </View>
        </Card>
      ) : null}
      {live && active ? (
        <View style={{ gap: 6 }}>
          <Text style={s.h}>Live comments</Text>
          <LiveChat room={`chat-live-${playerId}`} prefix="golive" inline />
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

function Ctl({ icon, label, onPress, testID, active, danger }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; testID: string; active?: boolean; danger?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.ctl, active && s.ctlOn, danger && s.ctlDanger, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={24} color={danger ? '#fff' : active ? C.bg : C.text} />
      <Text style={[s.ctlT, danger && { color: '#fff' }, active && { color: C.bg }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  controls: { flexDirection: 'row', gap: 8 },
  ctl: { flex: 1, minHeight: 64, borderRadius: 14, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', gap: 4 },
  ctlOn: { backgroundColor: C.accent, borderColor: C.accent },
  ctlDanger: { backgroundColor: C.live, borderColor: C.live },
  ctlT: { color: C.text, fontSize: 12, fontWeight: '800' },
  status: { color: C.sub, fontSize: 13, textAlign: 'center' },
  qrBox: { backgroundColor: '#fff', padding: 12, borderRadius: 12 },
  h: { color: C.text, fontSize: 18, fontWeight: '800' },
  preview: { width: '100%', aspectRatio: 3 / 4, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  label: { color: C.sub, fontSize: 13 },
  mono: { color: C.text, fontFamily: 'monospace', fontSize: 13 },
});
