import { useEffect } from 'react';
import { Alert } from 'react-native';
import { api, getBaseUrl } from '@/api/client';

/**
 * Personal push over the self-hosted ntfy server (port 8090; no Firebase / BaaS): while signed in, subscribes
 * to the member's HMAC-named topics and surfaces each message (co-stream invites, order updates) in-app.
 */
export function useNotifications(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const me = await api<{ ntfy_port: number; topics: string[] }>('/api/v1/me/notifications');
        const host = new URL(getBaseUrl()).hostname;
        const open = () => {
          ws = new WebSocket(`ws://${host}:${me.ntfy_port}/${me.topics.join(',')}/ws`);
          ws.onmessage = (e) => {
            try {
              const m = JSON.parse(String(e.data));
              if (m.event === 'message') Alert.alert(m.title ?? 'NaSCon Live', m.message ?? '');
            } catch {}
          };
          ws.onclose = () => {
            if (!closed) timer = setTimeout(open, 5000);
          };
        };
        if (!closed) open();
      } catch {
        /* offline or older server: notifications simply stay off */
      }
    })();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [signedIn]);
}
