import React, { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useApp } from '@/state/app';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { money } from '@/theme';

export default function ReceiptScreen() {
  const { receipt } = useApp();
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad'; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!receipt)
    return (
      <Screen testID="screen-receipt">
        <EmptyState title="No receipt yet" hint="Receipts appear here after you buy something." icon="receipt-outline" />
        <Button label="Go to store" testID="receipt-store" onPress={() => router.replace('/store')} />
      </Screen>
    );
  const p = receipt.payload;
  const download = async () => {
    if (!receipt.pdf_base64) return setMsg({ k: 'bad', t: 'The PDF receipt is not available for this order.' });
    setBusy(true);
    try {
      const uri = `${FileSystem.cacheDirectory}receipt-${p.order_id}.pdf`;
      await FileSystem.writeAsStringAsync(uri, receipt.pdf_base64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Receipt' });
        setMsg({ k: 'ok', t: 'Receipt ready to save or share.' });
      } else setMsg({ k: 'ok', t: 'Receipt saved on this device.' });
    } catch {
      setMsg({ k: 'bad', t: 'Could not open the PDF receipt. Please try again.' });
    }
    setBusy(false);
  };
  return (
    <Screen testID="screen-receipt">
      <ErrorBanner kind="ok" message="Payment successful. Thank you!" />
      <H>Receipt</H>
      <Card testID="receipt-card">
        <Text style={T.sub}>Order</Text>
        <Text style={{ fontSize: 16, fontWeight: '800' }} testID="receipt-order-id" selectable>{p.order_id}</Text>
        {p.paid_at ? <Text style={T.sub}>Paid: {new Date(p.paid_at).toLocaleString()}</Text> : null}
        {p.items.map((i) => (
          <Text key={i.variant_id} style={T.body}>{i.quantity} x {i.variant_id} @ {money(i.unit_price_minor, p.currency)}</Text>
        ))}
        <Text style={T.sub}>Subtotal: {money(p.subtotal_minor, p.currency)}</Text>
        {p.discount_minor > 0 ? <Text style={T.sub}>Discount: -{money(p.discount_minor, p.currency)}</Text> : null}
        <Text style={{ fontSize: 22, fontWeight: '800' }} testID="receipt-total">Total: {money(p.total_minor, p.currency)}</Text>
      </Card>
      {msg ? <ErrorBanner kind={msg.k} message={msg.t} /> : null}
      <Button label="Download / share PDF" icon="download" testID="receipt-download" onPress={download} loading={busy} />
      <Button label="Continue shopping" variant="secondary" icon="storefront" testID="receipt-done" onPress={() => router.replace('/store')} />
    </Screen>
  );
}
