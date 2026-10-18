import React from 'react';
import { Image, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/state/app';
import { SyncPill } from '@/components/SyncBar';
import { C, F, onColor } from '@/theme';

function TenantTitle({ rightIcons }: { rightIcons: number }) {
  const { session, primary } = useApp();
  const { width } = useWindowDimensions();
  const t = session?.tenant;
  // leave room for the header buttons (48 px each + compact sync pill + margins) so the name never runs under them
  const maxWidth = Math.max(120, width - rightIcons * 48 - 72);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth }} testID="tenant-header" accessible accessibilityLabel={`Organisation ${t?.name ?? ''}`}>
      {t?.logo_url ? (
        <Image source={{ uri: t.logo_url }} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card2 }} accessibilityLabel="Organisation logo" />
      ) : (
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: onColor(primary), fontFamily: F.displayHeavy, fontSize: 20 }}>{(t?.name ?? '?').charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <Text style={{ color: C.text, fontFamily: F.displayHeavy, fontSize: 22, letterSpacing: 0.5, textTransform: 'uppercase', flexShrink: 1 }} numberOfLines={1}>
        {t?.name ?? 'NaSCon League'}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { session, primary, cart } = useApp();
  const cartCount = cart.reduce((a, c) => a + c.quantity, 0);
  const role = session?.user.role;
  const canManage = role === 'club_manager' || role === 'league_organizer' || role === 'super_admin';
  const isOrganizer = role === 'league_organizer' || role === 'super_admin';
  const rightIcons = 2 + (session?.user.player_id ? 1 : 0) + (isOrganizer ? 1 : 0);
  const icon = (n: React.ComponentProps<typeof Ionicons>['name']) => ({ color, size }: { color: any; size: number }) => <Ionicons name={n} size={size} color={color} />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.bg },
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        headerTintColor: C.text,
        sceneStyle: { backgroundColor: C.bg },
        headerTitle: () => <TenantTitle rightIcons={rightIcons} />,
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 }}>
          <SyncPill compact />
          <Pressable testID="open-scan" accessibilityLabel="Scan a match QR code" accessibilityRole="button" onPress={() => router.push('/scan')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="qr-code-outline" size={24} color={C.text} />
          </Pressable>
          {session?.user.player_id ? (
            <Pressable testID="open-golive" accessibilityLabel="Go live" accessibilityRole="button" onPress={() => router.push('/golive')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="radio-outline" size={24} color={C.live} />
            </Pressable>
          ) : null}
          {isOrganizer ? (
            <Pressable testID="open-create-match" accessibilityLabel="Create match" accessibilityRole="button" onPress={() => router.push('/create-match')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="add-circle-outline" size={24} color={C.text} />
            </Pressable>
          ) : null}
          <Pressable testID="open-settings" accessibilityLabel="Settings and account" accessibilityRole="button" onPress={() => router.push('/settings')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="settings-outline" size={24} color={C.text} />
          </Pressable>
          </View>
        ),
        tabBarActiveTintColor: C.text,
        tabBarActiveBackgroundColor: primary + '55',
        tabBarInactiveTintColor: '#8A99BC',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        tabBarStyle: { minHeight: 60, backgroundColor: C.card, borderTopColor: C.border, borderTopWidth: 1 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Fixtures', tabBarIcon: icon('calendar'), tabBarButtonTestID: 'tab-fixtures', tabBarAccessibilityLabel: 'Fixtures' }} />
      <Tabs.Screen name="standings" options={{ title: 'Standings', tabBarIcon: icon('trophy'), tabBarButtonTestID: 'tab-standings', tabBarAccessibilityLabel: 'Standings' }} />
      <Tabs.Screen name="club" options={{ title: 'Club', tabBarIcon: icon('shield'), tabBarButtonTestID: 'tab-club', tabBarAccessibilityLabel: 'Club profile' }} />
      <Tabs.Screen name="store" options={{ title: 'Store', tabBarIcon: icon('cart'), tabBarButtonTestID: 'tab-store', tabBarAccessibilityLabel: 'Store', tabBarBadge: cartCount > 0 ? cartCount : undefined, tabBarBadgeStyle: { backgroundColor: C.accent, color: C.bg, fontWeight: '900', fontSize: 12 } }} />
      <Tabs.Screen
        name="manage"
        options={{
          title: role === 'club_manager' ? 'Roster' : role === 'league_organizer' ? 'Scoring' : 'Manage',
          href: canManage ? undefined : null,
          tabBarIcon: icon(role === 'league_organizer' ? 'create' : 'people'),
          tabBarButtonTestID: 'tab-manage',
          tabBarAccessibilityLabel: role === 'club_manager' ? 'Roster management' : 'Scoring entry',
        }}
      />
    </Tabs>
  );
}
