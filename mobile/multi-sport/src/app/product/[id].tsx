import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '@/api/client';
import type { Product } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { Screen, T } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Chips } from '@/components/Chips';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { ProductHero, StockBadge } from '@/components/ProductHero';
import { C, F, money } from '@/theme';

function Stepper({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const btn = (icon: 'remove' | 'add', next: number, off: boolean, id: string) => (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={icon === 'add' ? 'Increase quantity' : 'Decrease quantity'}
      disabled={off}
      onPress={() => onChange(next)}
      style={({ pressed }) => ({
        width: 48, height: 48, borderRadius: 24, backgroundColor: C.card2, borderWidth: 1.5, borderColor: C.border,
        alignItems: 'center', justifyContent: 'center', opacity: off ? 0.4 : 1, transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Ionicons name={icon} size={22} color={C.text} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      {btn('remove', value - 1, value <= 1, 'qty-minus')}
      <Text testID="qty-value" style={{ minWidth: 28, textAlign: 'center', fontSize: 24, fontFamily: F.displayHeavy, color: C.text }}>{value}</Text>
      {btn('add', value + 1, value >= max, 'qty-plus')}
    </View>
  );
}

export default function ProductDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { addToCart, cart } = useApp();
  const q = useCached<Product[]>('products', async () => (await api<{ products: Product[] }>('/api/v1/store/products')).products ?? []);
  const p = q.data?.find((x) => x.product_id === id);
  const [vid, setVid] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const count = cart.reduce((a, c) => a + c.quantity, 0);

  const v = p ? p.variants.find((x) => x.variant_id === vid) ?? p.variants.find((x) => x.stock > 0) ?? p.variants[0] : undefined;
  const max = Math.max(1, Math.min(v?.stock ?? 1, 10));

  return (
    <Screen
      testID="screen-product"
      loading={q.loading && !q.data}
      footer={p && v ? (
        <View style={{ padding: 12, gap: 8, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border }}>
          <Button
            label={v.stock <= 0 ? 'Sold out' : `Add ${qty} to cart · ${money(v.price_minor * qty, v.currency)}`}
            icon="cart"
            testID={`details-add-${p.product_id}`}
            disabled={v.stock <= 0}
            onPress={() => {
              for (let i = 0; i < qty; i++) addToCart({ variant_id: v.variant_id, product_name: p.name, label: v.label, price_minor: v.price_minor, currency: v.currency });
              setAdded(true);
              setQty(1);
            }}
          />
          {count > 0 ? (
            <Button label={added ? `Added. Go to checkout (${count})` : `View cart (${count})`} icon="card" variant="secondary" testID="details-checkout" onPress={() => router.push('/checkout')} />
          ) : null}
        </View>
      ) : undefined}
    >
      {q.error && !q.data ? <ErrorBanner message={q.error} onRetry={q.reload} /> : null}
      {q.data && !p ? <EmptyState title="Product not found" hint="It may have been removed from the store." icon="bag-outline" /> : null}
      {p ? (
        <>
          <View style={{ marginHorizontal: -16, marginTop: -16 }}>
            <ProductHero p={p} v={v} height={240} />
          </View>
          <View style={{ gap: 6, marginTop: 4 }}>
            <Text style={{ fontSize: 32, fontFamily: F.displayHeavy, color: C.text, letterSpacing: 0.5, textTransform: 'uppercase' }}>{p.name}</Text>
            {v ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ fontSize: 34, fontFamily: F.displayHeavy, color: C.accent }}>{money(v.price_minor, v.currency)}</Text>
                <StockBadge v={v} />
              </View>
            ) : null}
          </View>
          {p.description ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: C.sub, letterSpacing: 1, textTransform: 'uppercase' }}>About this item</Text>
              <Text style={[T.body, { lineHeight: 23 }]}>{p.description}</Text>
            </View>
          ) : null}
          {p.variants.length > 1 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: C.sub, letterSpacing: 1, textTransform: 'uppercase' }}>Select option</Text>
              <Chips
                testIDPrefix={`details-variant-${p.product_id}`}
                value={v?.variant_id ?? null}
                onChange={(x) => { setVid(x); setQty(1); setAdded(false); }}
                options={p.variants.map((x) => ({ value: x.variant_id, label: x.stock <= 0 ? `${x.label} · sold out` : x.label }))}
              />
            </View>
          ) : null}
          {v && v.stock > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: C.sub, letterSpacing: 1, textTransform: 'uppercase' }}>Quantity</Text>
              <Stepper value={qty} max={max} onChange={(n) => { setQty(n); setAdded(false); }} />
            </View>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
