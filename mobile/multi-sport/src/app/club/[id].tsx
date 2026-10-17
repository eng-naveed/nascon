import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ClubProfile } from '@/features/club/ClubProfile';

export default function ClubRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return <ClubProfile clubId={String(id)} fallbackName={name ? String(name) : undefined} />;
}
