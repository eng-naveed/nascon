import { createHmac } from 'node:crypto';
import { config } from '../../../core/config';

/**
 * Self-hosted push (binwiederhier/ntfy, no Firebase/BaaS): mirrors targeted notifications to a per-user ntfy
 * topic so a backgrounded phone still gets them. Topic names are HMAC-derived, so they cannot be guessed.
 */
export const ntfyTopic = (userId: string) => 'nascon-' + createHmac('sha256', config.day2Salt).update('ntfy|' + userId).digest('base64url').slice(0, 22);

type Post = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean }>;

/** Fire-and-forget; resolves false when ntfy is not configured or unreachable. Never throws. */
export async function pushNtfy(userId: string, title: string, message: string, base = process.env.NTFY_URL ?? '', post: Post = fetch as unknown as Post) {
  if (!base) return false;
  try {
    const r = await post(base.replace(/\/$/, '') + '/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: ntfyTopic(userId), title, message, tags: ['sports'] }),
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
