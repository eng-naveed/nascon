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

/** In-process gauges set by live subsystems (WS hub, media supervisor). */
const gauges = new Map<string, number>();
export const setGauge = (name: string, v: number) => void gauges.set(name, v);
export const getGauge = (name: string) => gauges.get(name) ?? 0;

export type MetricType = 'counter' | 'gauge';

/** Exact Prometheus text exposition Content-Type required by the spec (no charset suffix). */
export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4';

/**
 * `types` overrides the suffix heuristic, e.g. nascon_active_streams_total is a gauge despite its name.
 */
export function renderMetrics(extra: Record<string, number> = {}, types: Record<string, MetricType> = {}): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const typeOf = (n: string): MetricType =>
    types[n] ?? (n.endsWith('_total') || n.endsWith('_count') || n.endsWith('_sum') ? 'counter' : 'gauge');
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
