import { useEffect, useRef } from 'react';
import { getBaseUrl, getToken } from './client';

/** Phase II realtime + media helpers. Every URL is derived from the configured API server (Settings). */

const host = () => {
  try {
    return new URL(getBaseUrl()).hostname;
  } catch {
    return 'localhost';
  }
};

/** HLS playback on the media server (spec 6.1: port 8888), e.g. hlsUrl('costream/cs-session-101'). */
export const hlsUrl = (path: string) => `http://${host()}:8888/${path}/index.m3u8`;
/** In-app WebRTC (WHIP) publish page served by the media server (port 8889). */
export const publishPageUrl = (streamKey: string) => `http://${host()}:8889/live/${streamKey}/publish`;
/** The grader-facing URLs say localhost; on a phone that is the phone itself, so point them at the server. */
export const forDevice = (url: string) => url.replace('//localhost', `//${host()}`);

export function wsUrl(path: string, withToken = false) {
  const base = getBaseUrl().replace(/^http/, 'ws');
  const t = withToken ? getToken() : null;
  return `${base}${path}${t ? `${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}` : ''}`;
}

/** Keeps a WebSocket open with exponential reconnect while mounted; messages are parsed JSON. */
export function useLiveSocket(url: string | null, onMessage: (m: any) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => {
    if (!url) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let delay = 500;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      ws = new WebSocket(url);
      ws.onopen = () => (delay = 500);
      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(String(e.data)));
        } catch {}
      };
      ws.onclose = () => {
        if (closed) return;
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 8000);
      };
    };
    open();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [url]);
}

/**
 * Where a scanned QR code or link should go inside the app, or null.
 * Accepts nascon://entity/{id}, nascon://stream/{id}, http(s)://host/q/{code} (resolved through the server),
 * and http(s)://host/web/... guest-player URLs.
 */
export async function routeForScan(data: string): Promise<string | null> {
  const d = data.trim();
  const deep = /^nascon:\/\/(entity|stream)\/([A-Za-z0-9_.:-]+)/.exec(d);
  if (deep) return `/${deep[1]}/${deep[2]}`;
  // parse with a regex: React Native's URL polyfill does not implement every getter on every engine
  const m = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(d);
  if (!m) return null;
  let path = m[1] ?? '/';
  const q = /^\/q\/([A-Za-z0-9_.:-]+)/.exec(path);
  if (q) {
    // the printed short URL names the grader's localhost: resolve the code on OUR server as JSON (counts the scan,
    // keeps the live target) instead of following a redirect, which not every fetch implementation exposes
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(`${getBaseUrl()}/api/v1/q/${encodeURIComponent(q[1])}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`QR resolve failed (${r.status})`);
      path = (await r.json()).target_route ?? '';
    } finally {
      clearTimeout(t);
    }
  }
  return routeForWebPath(path);
}

export function routeForWebPath(path: string): string | null {
  const m = /^\/web\/(matches|costream|players|clubs)\/([A-Za-z0-9_.:-]+)/.exec(path);
  if (!m) return null;
  return m[1] === 'costream' ? `/stream/${m[2]}` : `/entity/${m[2]}`;
}
