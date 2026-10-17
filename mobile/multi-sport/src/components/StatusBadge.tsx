import React from 'react';
import { Badge } from './Badge';

export function StatusBadge({ status }: { status: string }) {
  if (status === 'in_progress') return <Badge kind="bad" icon="radio" text="LIVE" />;
  if (status === 'completed') return <Badge kind="ok" icon="checkmark-circle" text="Final" />;
  return <Badge kind="info" icon="time" text="Upcoming" />;
}
