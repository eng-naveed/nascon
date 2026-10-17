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
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { productIcon } from '@/components/ProductHero';
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
  const itemCount = p.items.reduce((n, i) => n + i.quantity, 0);
  const paidAt = p.paid_at ? new Date(p.paid_at) : null;
  const paidLabel = paidAt && !isNaN(paidAt.getTime())
    ? paidAt.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const label = (t: string) => <Text style={{ fontSize: 12, fontWeight: '800', color: C.sub, letterSpacing: 1, textTransform: 'uppercase' }}>{t}</Text>;
  const dashed = (
    <View style={{ marginHorizontal: -18, height: 28, justifyContent: 'center' }}>
      <View style={{ marginHorizontal: 14, height: 1, overflow: 'hidden' }}>
        <View style={{ height: 2, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.border }} />
      </View>
      <View style={{ position: 'absolute', left: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: C.bg }} />
      <View style={{ position: 'absolute', right: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: C.bg }} />
    </View>
  );
  const line = (k: string, v: string, color: string = C.sub) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 15, color: C.sub }}>{k}</Text>
      <Text style={{ fontSize: 15, fontWeight: '700', color }}>{v}</Text>
    </View>
  );
  return (
    <Screen testID="screen-receipt">
      <View testID="banner-ok" accessible accessibilityRole="alert" accessibilityLabel={`Payment successful. Thank you! You paid ${money(p.total_minor, p.currency)}.`} style={{ alignItems: 'center', gap: 4, paddingVertical: 22, paddingHorizontal: 16, borderRadius: 22, backgroundColor: C.okBg, borderWidth: 1.5, borderColor: C.ok }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.ok, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
          <Ionicons name="checkmark" size={40} color={C.bg} />
        </View>
        <Text style={{ fontSize: 14, color: C.ok, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }}>Payment successful</Text>
        <Text style={{ fontSize: 52, fontFamily: F.displayHeavy, color: C.accent, textAlign: 'center', lineHeight: 58 }} adjustsFontSizeToFit numberOfLines={1}>{money(p.total_minor, p.currency)}</Text>
        <Text style={{ fontSize: 15, color: C.sub, textAlign: 'center' }}>Thank you! Your order is confirmed.</Text>
      </View>
      <Card testID="receipt-card" style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Ionicons name="receipt" size={20} color={C.accent} />
          <Text style={{ fontSize: 22, fontFamily: F.displayHeavy, color: C.text, letterSpacing: 0.6, textTransform: 'uppercase', flex: 1 }}>Receipt</Text>
          <Text style={{ fontSize: 13, color: C.sub, fontWeight: '700' }}>{itemCount} {itemCount === 1 ? 'item' : 'items'}</Text>
        </View>
        <View style={{ gap: 2 }}>
          {label('Order')}
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }} testID="receipt-order-id" selectable>{p.order_id}</Text>
          {paidLabel ? <Text style={{ fontSize: 14, color: C.sub, marginTop: 2 }}>{paidLabel}</Text> : null}
        </View>
        {dashed}
        <View style={{ gap: 16 }}>
          {p.items.map((i) => {
            const full = receipt.item_names?.[i.variant_id] ?? names[i.variant_id] ?? i.variant_id;
            const m = /^(.*) \((.*)\)$/.exec(full);
            return (
              <View key={i.variant_id} testID={`receipt-item-${i.variant_id}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: C.card2, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={productIcon(m ? m[1] : full)} size={22} color={C.accent} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>{m ? m[1] : full}</Text>
                  <Text style={{ color: C.sub, fontSize: 14 }}>{m ? `${m[2]} · ` : ''}{i.quantity} × {money(i.unit_price_minor, p.currency)}</Text>
                </View>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>{money(i.unit_price_minor * i.quantity, p.currency)}</Text>
              </View>
            );
          })}
        </View>
        {dashed}
        {p.discount_minor > 0 ? (
          <View style={{ gap: 6 }}>
            {line('Subtotal', money(p.subtotal_minor, p.currency))}
            {line('Discount', `-${money(p.discount_minor, p.currency)}`, C.ok)}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: p.discount_minor > 0 ? 12 : 0 }}>
          <Text style={{ fontSize: 16, fontWeight: '800', color: C.text, textTransform: 'uppercase', letterSpacing: 0.8 }}>Total</Text>
          <Text style={{ fontSize: 30, fontFamily: F.displayHeavy, color: C.text }} testID="receipt-total">{money(p.total_minor, p.currency)}</Text>
        </View>
      </Card>
      {msg ? <ErrorBanner kind={msg.k} message={msg.t} /> : null}
      <Button label="Download / share PDF" icon="download" testID="receipt-download" onPress={download} loading={busy} />
      <Button label="Continue shopping" variant="secondary" icon="storefront" testID="receipt-done" onPress={() => router.replace('/store')} />
    </Screen>
  );
}
