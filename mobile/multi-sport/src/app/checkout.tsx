import React, { useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api, friendly } from '@/api/client';
import type { Receipt } from '@/api/types';
import { useApp } from '@/state/app';
import { Screen, H, T } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Chips } from '@/components/Chips';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { EmptyState } from '@/components/EmptyState';
import { ErrorBanner } from '@/components/ErrorBanner';
import { money, uid } from '@/theme';

const TOKENS = [
  { value: 'tok_success', label: 'Success card' },
  { value: 'tok_declined', label: 'Declined card' },
  { value: 'tok_capture_fail', label: 'Capture fails' },
];

export default function Checkout() {
  const { cart, setQty, clearCart, session, online, setReceipt } = useApp();
  const [token, setToken] = useState('tok_success');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const orderId = useRef(uid('ord-'));
  const currency = cart[0]?.currency ?? 'PKR';
  const subtotal = cart.reduce((a, c) => a + c.price_minor * c.quantity, 0);
  const discount = code.trim().toUpperCase() === 'WELCOME10' ? Math.floor((subtotal * 10) / 100) : 0;

  const pay = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<any>('/api/v1/checkout', {
        body: {
          order_id: orderId.current,
          customer_id: session?.user.id ?? 'guest',
          items: cart.map((c) => ({ variant_id: c.variant_id, quantity: c.quantity })),
          discount_code: code.trim() ? code.trim().toUpperCase() : null,
          payment: { token },
        },
        timeoutMs: 20000,
      });
      const receipt: Receipt = r.receipt ?? {
        payload: { order_id: r.order_id, customer_id: session?.user.id ?? '', items: r.items, subtotal_minor: r.subtotal_minor, discount_minor: r.discount_minor, total_minor: r.total_minor, currency: r.currency, paid_at: '' },
        signature: '',
      };
      setReceipt(receipt);
      clearCart();
      orderId.current = uid('ord-');
      router.replace('/receipt');
    } catch (e) {
      setErr(friendly(e));
      // A declined/failed payment is a new attempt next time, so use a fresh order id.
      orderId.current = uid('ord-');
    }
    setBusy(false);
  };
  const confirm = () => {
    if (!online) return setErr('You are offline. Checkout needs an internet connection. Your cart is saved.');
    Alert.alert('Confirm payment', `Pay ${money(subtotal - discount, currency)} using the selected payment option?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay now', onPress: pay },
    ]);
  };

  return (
    <Screen testID="screen-checkout">
      <H>Your cart</H>
      {cart.length === 0 ? (
        <>
          <EmptyState title="Your cart is empty" hint="Add something from the store." icon="cart-outline" />
          <Button label="Back to store" icon="storefront" testID="cart-back-store" onPress={() => router.replace('/store')} />
        </>
      ) : (
        <>
          {cart.map((c) => (
            <Card key={c.variant_id} testID={`cart-${c.variant_id}`}>
              <Text style={T.body}>{c.product_name} ({c.label})</Text>
              <Text style={T.sub}>{money(c.price_minor, c.currency)} each</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
                <Button small label="−" testID={`qty-minus-${c.variant_id}`} variant="secondary" onPress={() => setQty(c.variant_id, c.quantity - 1)} />
                <Text style={{ fontSize: 20, fontWeight: '800' }} testID={`qty-${c.variant_id}`}>{c.quantity}</Text>
                <Button small label="+" testID={`qty-plus-${c.variant_id}`} variant="secondary" onPress={() => setQty(c.variant_id, c.quantity + 1)} />
                <Button small label="Remove" icon="trash" testID={`remove-${c.variant_id}`} variant="secondary" onPress={() => setQty(c.variant_id, 0)} />
              </View>
            </Card>
          ))}
          <Field label="Discount code (optional)" testID="discount-code" value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="WELCOME10" />
          <Text style={{ fontSize: 14, fontWeight: '700' }}>Payment (mock gateway)</Text>
          <Chips testIDPrefix="pay" value={token} onChange={setToken} options={TOKENS} />
          <Card>
            <Text style={T.sub}>Subtotal: {money(subtotal, currency)}</Text>
            {discount > 0 ? <Text style={T.sub}>Discount: -{money(discount, currency)}</Text> : null}
            <Text style={{ fontSize: 22, fontWeight: '800' }} testID="cart-total">Total: {money(subtotal - discount, currency)}</Text>
          </Card>
          {err ? <ErrorBanner message={err} /> : null}
          <Button label={`Buy now  ${money(subtotal - discount, currency)}`} icon="card" testID="checkout-pay" onPress={confirm} loading={busy} />
          <Button label="Empty cart" variant="secondary" icon="trash" testID="cart-clear" onPress={() => Alert.alert('Empty cart?', 'Remove every item from your cart?', [{ text: 'Keep', style: 'cancel' }, { text: 'Empty', style: 'destructive', onPress: clearCart }])} />
        </>
      )}
    </Screen>
  );
}
