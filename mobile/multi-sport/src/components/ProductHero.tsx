import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Product, Variant } from '@/api/types';
import { Badge } from '@/components/Badge';
import { teamColor } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function productIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (/jersey|shirt|kit|tee|hoodie/.test(n)) return 'shirt';
  if (/ball|football|soccer/.test(n)) return 'football';
  if (/bottle|water|flask/.test(n)) return 'water';
  if (/cap|hat|scarf/.test(n)) return 'ribbon';
  if (/trophy|medal|cup/.test(n)) return 'trophy';
  return 'bag-handle';
}

export function StockBadge({ v }: { v: Variant }) {
  if (v.stock <= 0) return <Badge kind="bad" icon="close-circle" text="Sold out" />;
  if (v.stock <= 3) return <Badge kind="warn" icon="flame" text={`Only ${v.stock} left`} />;
  return <Badge kind="ok" icon="checkmark-circle" text="In stock" />;
}

/** Tinted tile standing in for a product photo (the API has no image field yet). */
export function ProductHero({ p, v, height = 150 }: { p: Product; v?: Variant; height?: number }) {
  const tint = teamColor(p.product_id);
  const disc = Math.round(height * 0.64);
  return (
    <View style={{ height, backgroundColor: `${tint}26`, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: disc, height: disc, borderRadius: disc / 2, backgroundColor: `${tint}40`, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={productIcon(p.name)} size={Math.round(disc * 0.54)} color="#FFFFFF" />
      </View>
      {v ? (
        <View style={{ position: 'absolute', top: 12, right: 12 }}>
          <StockBadge v={v} />
        </View>
      ) : null}
    </View>
  );
}
