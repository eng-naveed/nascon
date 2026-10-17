import React, { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
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
import { money } from '@/theme';

function ProductCard({ p }: { p: Product }) {
  const { addToCart } = useApp();
  const [vid, setVid] = useState<string | null>(p.variants[0]?.variant_id ?? null);
  const [added, setAdded] = useState(false);
  const v = p.variants.find((x) => x.variant_id === vid);
  return (
    <Card testID={`product-${p.product_id}`}>
      <Text style={{ fontSize: 18, fontWeight: '800', color: '#111827' }}>{p.name}</Text>
      {p.description ? <Text style={T.sub}>{p.description}</Text> : null}
      <View style={{ marginVertical: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 4 }}>Choose a variant</Text>
        <Chips testIDPrefix={`variant-${p.product_id}`} value={vid} onChange={(x) => { setVid(x); setAdded(false); }} options={p.variants.map((x) => ({ value: x.variant_id, label: x.label }))} />
      </View>
      {v ? (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: '#111827' }}>{money(v.price_minor, v.currency)}</Text>
          {v.stock > 0 ? <Badge kind="ok" icon="checkmark-circle" text={`${v.stock} in stock`} /> : <Badge kind="bad" icon="close-circle" text="Out of stock" />}
          <Button
            label={added ? 'Added. Add another' : 'Add to cart'}
            icon="cart"
            testID={`add-to-cart-${p.product_id}`}
            disabled={v.stock <= 0}
            onPress={() => { addToCart({ variant_id: v.variant_id, product_name: p.name, label: v.label, price_minor: v.price_minor, currency: v.currency }); setAdded(true); }}
          />
        </View>
      ) : null}
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
    <Screen testID="screen-store" loading={q.loading && !q.data} onRefresh={q.reload}>
      <CacheNote fromCache={q.fromCache} updatedAt={q.updatedAt} />
      <Button label={`View cart (${count})`} icon="cart" variant="secondary" testID="open-cart" onPress={() => router.push('/checkout')} />
      <H>Merchandise</H>
      {q.error && !q.data ? <ErrorBanner message={q.error} onRetry={q.reload} /> : null}
      {q.data && q.data.length === 0 ? <EmptyState title="No products yet" hint="The store is empty right now. Please check back soon." icon="bag-outline" /> : null}
      {(q.data ?? []).map((p) => <ProductCard key={p.product_id} p={p} />)}
    </Screen>
  );
}
