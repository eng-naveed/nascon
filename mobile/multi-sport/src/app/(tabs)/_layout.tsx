import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/state/app';
import { C, F, onColor } from '@/theme';

function TenantTitle() {
  const { session, primary } = useApp();
  const t = session?.tenant;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="tenant-header" accessible accessibilityLabel={`Organisation ${t?.name ?? ''}`}>
      {t?.logo_url ? (
        <Image source={{ uri: t.logo_url }} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card2 }} accessibilityLabel="Organisation logo" />
      ) : (
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: onColor(primary), fontFamily: F.displayHeavy, fontSize: 20 }}>{(t?.name ?? '?').charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <Text style={{ color: C.text, fontFamily: F.displayHeavy, fontSize: 24, letterSpacing: 0.5, textTransform: 'uppercase' }} numberOfLines={1}>
        {t?.name ?? 'NaSCon League'}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { session, primary } = useApp();
  const role = session?.user.role;
  const canManage = role === 'club_manager' || role === 'league_organizer' || role === 'super_admin';
  const icon = (n: React.ComponentProps<typeof Ionicons>['name']) => ({ color, size }: { color: any; size: number }) => <Ionicons name={n} size={size} color={color} />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: C.bg },
        headerShadowVisible: false,
        headerTintColor: C.text,
        sceneStyle: { backgroundColor: C.bg },
        headerTitle: () => <TenantTitle />,
        headerRight: () => (
          <Pressable testID="open-settings" accessibilityLabel="Settings and account" accessibilityRole="button" onPress={() => router.push('/settings')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="settings-outline" size={24} color={C.text} />
          </Pressable>
        ),
        tabBarActiveTintColor: primary,
        tabBarInactiveTintColor: '#8A99BC',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        tabBarStyle: { minHeight: 60, backgroundColor: C.card, borderTopColor: C.border, borderTopWidth: 1 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Fixtures', tabBarIcon: icon('calendar'), tabBarButtonTestID: 'tab-fixtures', tabBarAccessibilityLabel: 'Fixtures' }} />
      <Tabs.Screen name="standings" options={{ title: 'Standings', tabBarIcon: icon('trophy'), tabBarButtonTestID: 'tab-standings', tabBarAccessibilityLabel: 'Standings' }} />
      <Tabs.Screen name="club" options={{ title: 'Club', tabBarIcon: icon('shield'), tabBarButtonTestID: 'tab-club', tabBarAccessibilityLabel: 'Club profile' }} />
      <Tabs.Screen name="store" options={{ title: 'Store', tabBarIcon: icon('cart'), tabBarButtonTestID: 'tab-store', tabBarAccessibilityLabel: 'Store' }} />
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
