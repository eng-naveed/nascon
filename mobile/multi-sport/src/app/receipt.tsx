import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Product } from '@/api/types';
import { cacheGet } from '@/db';
import { haptic } from '@/components/feedback';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useApp } from '@/state/app';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { money, C, F } from '@/theme';

export default function ReceiptScreen() {
  const { receipt } = useApp();
  const [msg, setMsg] = useState<{ k: 'ok' | 'bad'; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const orderId = receipt?.payload.order_id;
  useEffect(() => {
    if (!orderId) return;
    haptic('success');
    // Fallback names for receipts saved before item names were captured: look up the cached products.
    cacheGet<Product[]>('products')
      .then((c) => {
        const m: Record<string, string> = {};
        (c?.data ?? []).forEach((p) => p.variants.forEach((v) => { m[v.variant_id] = `${p.name} (${v.label})`; }));
        setNames(m);
      })
      .catch(() => {});
  }, [orderId]);
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
      <View testID="banner-ok" accessible accessibilityRole="alert" accessibilityLabel={`Payment successful. Thank you! You paid ${money(p.total_minor, p.currency)}.`} style={{ alignItems: 'center', gap: 6, paddingVertical: 20, paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.okBg, borderWidth: 1.5, borderColor: C.ok }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.ok, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="checkmark" size={46} color={C.bg} />
        </View>
        <Text style={{ fontSize: 30, fontFamily: F.displayHeavy, color: C.text, letterSpacing: 0.6, textTransform: 'uppercase', textAlign: 'center' }}>Payment successful</Text>
        <Text style={{ fontSize: 15, color: C.sub, textAlign: 'center' }}>Thank you! Your order is confirmed.</Text>
        <Text style={{ fontSize: 40, fontFamily: F.displayHeavy, color: C.accent, textAlign: 'center' }} adjustsFontSizeToFit numberOfLines={1}>{money(p.total_minor, p.currency)}</Text>
        <Text style={{ fontSize: 13, color: C.sub, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>Total paid</Text>
      </View>
      <H>Receipt</H>
      <Card testID="receipt-card">
        <Text style={T.sub}>Order</Text>
        <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }} testID="receipt-order-id" selectable>{p.order_id}</Text>
        {p.paid_at ? <Text style={T.sub}>Paid: {new Date(p.paid_at).toLocaleString()}</Text> : null}
        {p.items.map((i) => (
          <View key={i.variant_id} testID={`receipt-item-${i.variant_id}`} style={{ flexDirection: 'row', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.border }}>
            <Text style={[T.body, { flex: 1, fontWeight: '700' }]}>{i.quantity} × {receipt.item_names?.[i.variant_id] ?? names[i.variant_id] ?? i.variant_id}</Text>
            <Text style={T.body}>{money(i.unit_price_minor * i.quantity, p.currency)}</Text>
          </View>
        ))}
        <Text style={T.sub}>Subtotal: {money(p.subtotal_minor, p.currency)}</Text>
        {p.discount_minor > 0 ? <Text style={T.sub}>Discount: -{money(p.discount_minor, p.currency)}</Text> : null}
        <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }} testID="receipt-total">Total: {money(p.total_minor, p.currency)}</Text>
      </Card>
      {msg ? <ErrorBanner kind={msg.k} message={msg.t} /> : null}
      <Button label="Download / share PDF" icon="download" testID="receipt-download" onPress={download} loading={busy} />
      <Button label="Continue shopping" variant="secondary" icon="storefront" testID="receipt-done" onPress={() => router.replace('/store')} />
    </Screen>
  );
}
