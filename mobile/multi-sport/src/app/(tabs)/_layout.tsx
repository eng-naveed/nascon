import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/state/app';
import { onColor } from '@/theme';

function TenantTitle() {
  const { session, primary } = useApp();
  const fg = onColor(primary);
  const t = session?.tenant;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="tenant-header" accessible accessibilityLabel={`Organisation ${t?.name ?? ''}`}>
      {t?.logo_url ? (
        <Image source={{ uri: t.logo_url }} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff' }} accessibilityLabel="Organisation logo" />
      ) : (
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: fg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: primary, fontWeight: '800', fontSize: 16 }}>{(t?.name ?? '?').charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <Text style={{ color: fg, fontWeight: '800', fontSize: 18 }} numberOfLines={1}>
        {t?.name ?? 'NaSCon League'}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { session, primary } = useApp();
  const role = session?.user.role;
  const fg = onColor(primary);
  const canManage = role === 'club_manager' || role === 'league_organizer' || role === 'super_admin';
  const icon = (n: React.ComponentProps<typeof Ionicons>['name']) => ({ color, size }: { color: any; size: number }) => <Ionicons name={n} size={size} color={color} />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: primary },
        headerTintColor: fg,
        headerTitle: () => <TenantTitle />,
        headerRight: () => (
          <Pressable testID="open-settings" accessibilityLabel="Settings and account" accessibilityRole="button" onPress={() => router.push('/settings')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="settings" size={24} color={fg} />
          </Pressable>
        ),
        tabBarActiveTintColor: primary,
        tabBarInactiveTintColor: '#4B5563',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        tabBarStyle: { minHeight: 56 },
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
