import { config } from '../../../core/config';

/**
 * MediaMTX control API adapter (v1.9.1 route names, still aliased in later releases).
 * Severing an ingest = kicking every RTMP / WebRTC / RTSP / SRT session on the path. Never throws.
 */
export type Fetch = (url: string, init?: { method?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<any> }>;

const KINDS = ['rtmpconns', 'webrtcsessions', 'rtspsessions', 'srtconns'];

export async function kickPath(path: string, base = config.mediaApiUrl, f: Fetch = fetch as unknown as Fetch, timeoutMs = 1000): Promise<number> {
  if (!base) return 0;
  const root = base.replace(/\/$/, '') + '/v3';
  let kicked = 0;
  await Promise.all(
    KINDS.map(async (kind) => {
      try {
        const r = await f(`${root}/${kind}/list?itemsPerPage=1000`, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok) return;
        const items: { id: string; path: string }[] = (await r.json()).items ?? [];
        for (const it of items.filter((i) => i.path === path)) {
          const k = await f(`${root}/${kind}/kick/${it.id}`, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
          if (k.ok) kicked++;
        }
      } catch {
        /* media server down or kind disabled: the auth callback still refuses the key */
      }
    }),
  );
  return kicked;
}
