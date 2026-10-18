import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { C } from '@/theme';

/** Muted autoplaying HLS player for live feeds (match venue feed, co-stream composite, creator stream). */
export function LivePlayer({ uri, label, testID }: { uri: string; label: string; testID?: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.muted = true;
    p.loop = false;
    p.play();
  });
  return (
    <View style={s.box} testID={testID} accessibilityLabel={label}>
      <VideoView player={player} style={s.video} contentFit="contain" nativeControls />
    </View>
  );
}

const s = StyleSheet.create({
  box: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  video: { width: '100%', height: '100%' },
});
