import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '@/state/app';
import { SyncBar } from '@/components/SyncBar';
import { useFonts, BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed';
import { C, F } from '@/theme';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';

function Inner() {
  const { ready, session } = useApp();
  const insets = useSafeAreaInsets();
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
              contentStyle: { backgroundColor: C.bg },
            }}
          >
            <Stack.Protected guard={!session}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack.Protected>
            <Stack.Protected guard={!!session}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="match/[id]" options={{ title: 'Match' }} />
              <Stack.Screen name="club/[id]" options={{ title: 'Club profile' }} />
              <Stack.Screen name="scoring/[id]" options={{ title: 'Scoring entry' }} />
              <Stack.Screen name="checkout" options={{ title: 'Cart & checkout' }} />
              <Stack.Screen name="receipt" options={{ title: 'Receipt' }} />
              <Stack.Screen name="sync" options={{ title: 'Sync status' }} />
            </Stack.Protected>
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          </Stack>
        </View>
      </SafeAreaInsetsContext.Provider>
      <View style={{ paddingBottom: insets.bottom, backgroundColor: C.card }}>
        <SyncBar />
      </View>
    </View>
  );
}

export default function Root() {
  useAutoUpdate();
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Inner />
      </AppProvider>
    </SafeAreaProvider>
  );
}
