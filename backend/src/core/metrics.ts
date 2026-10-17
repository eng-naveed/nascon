/** Tiny Prometheus text-format registry (no dependency): request counters/latency + job counters. */
const counters = new Map<string, number>();
const startedAt = Date.now();

export function inc(name: string, labels: Record<string, string | number> = {}, by = 1) {
  const l = Object.entries(labels)
    .map(([k, v]) => `${k}="${String(v).replace(/[\\"\n]/g, '_')}"`)
    .join(',');
  const key = l ? `${name}{${l}}` : name;
  counters.set(key, (counters.get(key) ?? 0) + by);
}

export function renderMetrics(extra: Record<string, number> = {}): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const typeOf = (n: string) => (n.endsWith('_total') || n.endsWith('_count') || n.endsWith('_sum') ? 'counter' : 'gauge');
  const emit = (key: string, v: number) => {
    const name = key.split('{')[0];
    if (!seen.has(name)) {
      seen.add(name);
      lines.push(`# TYPE ${name} ${typeOf(name)}`);
    }
    lines.push(`${key} ${v}`);
  };
  for (const [k, v] of [...counters.entries()].sort()) emit(k, v);
  emit('process_uptime_seconds', Math.round((Date.now() - startedAt) / 1000));
  for (const [k, v] of Object.entries(extra)) emit(k, v);
  return lines.join('\n') + '\n';
}
