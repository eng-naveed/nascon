import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AppProvider, useApp } from '@/state/app';
import { SyncBanner, SyncPill } from '@/components/SyncBar';
import { useFonts, BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed';
import { C, F } from '@/theme';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import { useNotifications } from '@/hooks/useNotifications';
import { returnAfterLogin } from '@/components/LiveChat';

function Inner() {
  const { ready, session } = useApp();
  const insets = useSafeAreaInsets();
  useNotifications(!!session);
  const pathname = usePathname();
  // an inline login (stream / match chat) must leave the viewer where they were, not on the Fixtures tab
  useEffect(() => {
    const to = returnAfterLogin.path;
    if (!session || !to) return;
    if (pathname !== to) {
      returnAfterLogin.path = null;
      const t = setTimeout(() => router.navigate(to as never), 0);
      return () => clearTimeout(t);
    }
    // still on the right screen: keep watching briefly in case the guard flip resets navigation a moment later
    const t = setTimeout(() => {
      if (returnAfterLogin.path === to) returnAfterLogin.path = null;
    }, 1500);
    return () => clearTimeout(t);
  }, [session, pathname]);
  const [fontsLoaded, fontError] = useFonts({ BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold });
  if (!ready || (!fontsLoaded && !fontError))
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      <SafeAreaInsetsContext.Provider value={{ ...insets, bottom: 0 }}>
        <View style={{ flex: 1 }}>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: C.bg },
              headerTintColor: C.text,
              headerTitleStyle: { fontFamily: F.displayHeavy, fontSize: 24 },
              headerShadowVisible: false,
              headerBackButtonDisplayMode: 'minimal',
              headerBackTitle: 'Back',
              headerRight: () => <SyncPill />,
              contentStyle: { backgroundColor: C.bg },
            }}
          >
            <Stack.Protected guard={!session}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack.Protected>
            <Stack.Protected guard={!!session}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="match/[id]" options={{ title: 'Match' }} />
              <Stack.Screen name="product/[id]" options={{ title: 'Product' }} />
              <Stack.Screen name="club/[id]" options={{ title: 'Club profile' }} />
              <Stack.Screen name="scoring/[id]" options={{ title: 'Scoring entry' }} />
              <Stack.Screen name="checkout" options={{ title: 'Cart & checkout' }} />
              <Stack.Screen name="receipt" options={{ title: 'Receipt' }} />
              <Stack.Screen name="sync" options={{ title: 'Sync status' }} />
              <Stack.Screen name="golive" options={{ title: 'Go live' }} />
              <Stack.Screen name="create-match" options={{ title: 'Create match' }} />
            </Stack.Protected>
            {/* public: QR scans and nascon:// deep links open straight into the content, never the login wall */}
            <Stack.Screen name="entity/[id]" options={{ title: 'Live match' }} />
            <Stack.Screen name="stream/[id]" options={{ title: 'Co-stream' }} />
            <Stack.Screen name="scan" options={{ title: 'Scan QR' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          </Stack>
        </View>
      </SafeAreaInsetsContext.Provider>
      <View style={{ paddingBottom: insets.bottom, backgroundColor: C.bg }}>
        <SyncBanner />
      </View>
    </View>
  );
}

export default function Root() {
  useAutoUpdate();
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <AppProvider>
          <Inner />
        </AppProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
