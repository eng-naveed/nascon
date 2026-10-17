import React, { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { api } from '@/api/client';
import type { Product } from '@/api/types';
import { useApp } from '@/state/app';
import { useCached } from '@/state/useCached';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Chips } from '@/components/Chips';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { CacheNote } from '@/components/CacheNote';
import { Badge } from '@/components/Badge';
import { haptic } from '@/components/feedback';
import { ProductHero } from '@/components/ProductHero';
import { C, F, money } from '@/theme';

function ProductCard({ p }: { p: Product }) {
  const { addToCart } = useApp();
  const [vid, setVid] = useState<string | null>(p.variants[0]?.variant_id ?? null);
  const [added, setAdded] = useState(false);
  const v = p.variants.find((x) => x.variant_id === vid);
  const prices = p.variants.map((x) => x.price_minor);
  const varies = prices.length > 1 && Math.min(...prices) !== Math.max(...prices);
  return (
    <Card testID={`product-${p.product_id}`} style={{ padding: 0, overflow: 'hidden' }}>
      <Pressable
        testID={`open-product-${p.product_id}`}
        accessibilityRole="button"
        accessibilityLabel={`${p.name}, view details`}
        onPress={() => router.push({ pathname: '/product/[id]', params: { id: p.product_id } })}
      >
        <ProductHero p={p} v={v} />
      </Pressable>
      <View style={{ padding: 16, gap: 12 }}>
        <Pressable onPress={() => router.push({ pathname: '/product/[id]', params: { id: p.product_id } })} style={{ gap: 4 }}>
          <Text style={{ fontSize: 26, fontFamily: F.displayHeavy, color: C.text, letterSpacing: 0.5, textTransform: 'uppercase' }}>{p.name}</Text>
          {p.description ? <Text style={T.sub} numberOfLines={2}>{p.description}</Text> : null}
          <Text style={{ fontSize: 13, fontWeight: '800', color: C.info, letterSpacing: 0.4 }}>View details ›</Text>
        </Pressable>
        {p.variants.length > 1 ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: C.sub, letterSpacing: 1, textTransform: 'uppercase' }}>Select option</Text>
            <Chips testIDPrefix={`variant-${p.product_id}`} value={vid} onChange={(x) => { setVid(x); setAdded(false); }} options={p.variants.map((x) => ({ value: x.variant_id, label: x.label }))} />
          </View>
        ) : null}
        {v ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 4 }}>
            <View style={{ flex: 1 }}>
              {varies ? <Text style={{ fontSize: 12, color: C.sub, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>{v.label}</Text> : null}
              <Text style={{ fontSize: 32, fontFamily: F.displayHeavy, color: C.accent }}>{money(v.price_minor, v.currency)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={added ? 'Added ✓' : v.stock <= 0 ? 'Sold out' : 'Add to cart'}
                icon={added ? undefined : 'cart'}
                testID={`add-to-cart-${p.product_id}`}
                disabled={v.stock <= 0}
                onPress={() => { addToCart({ variant_id: v.variant_id, product_name: p.name, label: v.label, price_minor: v.price_minor, currency: v.currency }); setAdded(true); haptic('light'); }}
              />
            </View>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

export default function Store() {
  const { cart } = useApp();
  const q = useCached<Product[]>('products', async () => (await api<{ products: Product[] }>('/api/v1/store/products')).products ?? []);
  const reloadRef = useRef(q.reload);
  reloadRef.current = q.reload;
  useFocusEffect(useCallback(() => { reloadRef.current(); }, []));
  const count = cart.reduce((a, c) => a + c.quantity, 0);
  return (
    <Screen
      testID="screen-store"
      loading={q.loading && !q.data}
      onRefresh={q.reload}
      footer={count > 0 ? (
        <View style={{ padding: 12, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border }}>
          <Button label={`Checkout (${count} ${count === 1 ? 'item' : 'items'})`} icon="card" testID="checkout-sticky" onPress={() => router.push('/checkout')} />
        </View>
      ) : undefined}
    >
      <CacheNote fromCache={q.fromCache} updatedAt={q.updatedAt} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <H>Merchandise</H>
          <Text style={T.sub}>Official league gear</Text>
        </View>
        <Pressable
          testID="open-cart"
          accessibilityRole="button"
          accessibilityLabel={`View cart, ${count} items`}
          onPress={() => router.push('/checkout')}
          style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 28, backgroundColor: C.card2, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}
        >
          <Ionicons name="cart" size={26} color={C.text} />
          {count > 0 ? (
            <View style={{ position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: C.bg }}>{count}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {q.error && !q.data ? <ErrorBanner message={q.error} onRetry={q.reload} /> : null}
      {q.data && q.data.length === 0 ? <EmptyState title="No products yet" hint="The store is empty right now. Please check back soon." icon="bag-outline" /> : null}
      {(q.data ?? []).map((p) => <ProductCard key={p.product_id} p={p} />)}
    </Screen>
  );
}
