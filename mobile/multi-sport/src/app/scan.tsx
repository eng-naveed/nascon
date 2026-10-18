import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { routeForScan } from '@/api/live';
import { Button } from '@/components/Button';
import { ErrorBanner } from '@/components/ErrorBanner';
import { C } from '@/theme';

/** Scan a printed match / co-stream QR poster (FR-4.1) and open it in the app. Works without an account. */
export default function Scan() {
  const [perm, ask] = useCameraPermissions();
  const [err, setErr] = useState<string | null>(null);
  const busy = useRef(false);

  const onScan = async ({ data }: { data: string }) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const to = await routeForScan(data);
      if (to) router.replace(to as never);
      else setErr('This QR code is not a NaSCon match or stream.');
    } catch {
      setErr('Could not reach the server to open this code.');
    } finally {
      setTimeout(() => (busy.current = false), 1500);
    }
  };

  return (
    <View style={s.root} testID="screen-scan">
      <Stack.Screen options={{ title: 'Scan QR' }} />
      {!perm ? null : !perm.granted ? (
        <View style={{ gap: 12 }}>
          <Text style={s.text}>Allow camera access to scan a match QR code.</Text>
          <Button testID="scan-allow" label="Allow camera" icon="camera" onPress={ask} />
        </View>
      ) : (
        <CameraView style={s.cam} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} testID="scan-camera" />
      )}
      {err ? <ErrorBanner message={err} kind="warn" /> : null}
      <Text style={s.text}>Point the camera at a poster code. It opens the live match, replay or notice.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, padding: 16, gap: 12 },
  cam: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  text: { color: C.text, fontSize: 16 },
});
