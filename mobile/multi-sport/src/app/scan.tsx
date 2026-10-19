import React, { useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { routeForScan } from '@/api/live';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { haptic } from '@/components/feedback';
import { C } from '@/theme';

/** Scan a printed match / co-stream / player QR (FR-4.1) and open it in the app. Works without an account. */
export default function Scan() {
  const [perm, ask] = useCameraPermissions();
  const [err, setErr] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [camErr, setCamErr] = useState<string | null>(null);
  const busy = useRef(false);
  const last = useRef<{ data: string; at: number } | null>(null);

  const onScan = async ({ data }: BarcodeScanningResult) => {
    // the scanner fires many times per second while the code is in view: handle one at a time, and do not retry the
    // same code for a moment after it failed
    if (busy.current || !data) return;
    if (last.current && last.current.data === data && Date.now() - last.current.at < 2500) return;
    busy.current = true;
    last.current = { data, at: Date.now() };
    setErr(null);
    setOpening(data);
    haptic('success');
    try {
      const to = await routeForScan(data);
      if (to) router.replace(to as never);
      else setErr('This QR code is not a NaSCon match, stream or player.');
    } catch {
      setErr('Could not reach the server to open this code. Check the server address in Settings.');
    } finally {
      setOpening(null);
      busy.current = false;
    }
  };

  return (
    <View style={s.root} testID="screen-scan">
      <Stack.Screen options={{ title: 'Scan QR' }} />
      {!perm ? null : !perm.granted ? (
        <View style={{ gap: 12 }}>
          <Text style={s.text}>Allow camera access to scan a match QR code.</Text>
          {perm.canAskAgain ? (
            <Button testID="scan-allow" label="Allow camera" icon="camera" onPress={ask} />
          ) : (
            // a denied permission cannot be asked again from the app: send the user to the system settings
            <Button testID="scan-open-settings" label="Open settings to allow camera" icon="settings" onPress={() => Linking.openSettings()} />
          )}
        </View>
      ) : (
        // style the wrapper, not CameraView: rounded/clipped camera views can stop delivering frames on some Android devices
        <View style={s.camWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            autofocus="on"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScan}
            onMountError={(e) => setCamErr(e.message)}
            testID="scan-camera"
          />
          <View pointerEvents="none" style={s.frame} />
          {opening ? (
            <View style={s.opening} testID="scan-opening">
              <Text style={s.openingT}>Opening…</Text>
            </View>
          ) : null}
        </View>
      )}
      {camErr ? <ErrorBanner message={`Camera could not start: ${camErr}`} /> : null}
      {err ? <ErrorBanner message={err} kind="warn" /> : null}
      <Text style={s.text}>Point the camera at a match poster or a player's live QR. It opens the live match, stream, replay or notice.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, padding: 16, gap: 12 },
  camWrap: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  frame: { position: 'absolute', alignSelf: 'center', top: '20%', width: '70%', aspectRatio: 1, borderWidth: 3, borderColor: C.accent, borderRadius: 20 },
  opening: { position: 'absolute', bottom: 16, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  openingT: { color: '#fff', fontWeight: '800', fontSize: 16 },
  text: { color: C.text, fontSize: 16 },
});
