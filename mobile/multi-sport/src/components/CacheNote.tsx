import React from 'react';
import { ErrorBanner } from './ErrorBanner';

export function CacheNote({ fromCache, updatedAt }: { fromCache: boolean; updatedAt: string | null }) {
  if (!fromCache) return null;
  const when = updatedAt ? new Date(updatedAt).toLocaleString() : 'earlier';
  return <ErrorBanner kind="warn" message={`Offline: showing saved information from ${when}.`} />;
}
