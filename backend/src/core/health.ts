import net from 'node:net';

/** Raw RESP PING (no client library): resolves true only on "+PONG". */
export function checkRedis(url: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return resolve(false);
    }
    const sock = net.createConnection({ host: u.hostname, port: Number(u.port || 6379) });
    let buf = '';
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.on('error', () => done(false));
    sock.on('connect', () => sock.write('PING\r\n'));
    sock.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('\n')) done(buf.startsWith('+PONG'));
    });
  });
}

/** The media server is up if its control API answers with ANY HTTP status within the timeout. */
export async function checkMedia(baseUrl: string, timeoutMs = 500): Promise<boolean> {
  try {
    await fetch(baseUrl.replace(/\/$/, '') + '/v3/paths/list', { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

export interface HealthDeps {
  db: () => Promise<boolean>;
  redisUrl?: string;
  mediaApiUrl?: string;
}

export interface HealthResult {
  ok: boolean;
  checks: Record<string, 'ok' | 'down' | 'skipped'>;
}

/** Probes the database always, and Redis / the media server only when they are configured. */
export async function runHealth(deps: HealthDeps): Promise<HealthResult> {
  const [db, redis, media] = await Promise.all([
    deps.db().catch(() => false),
    deps.redisUrl ? checkRedis(deps.redisUrl) : Promise.resolve(null),
    deps.mediaApiUrl ? checkMedia(deps.mediaApiUrl) : Promise.resolve(null),
  ]);
  const tag = (v: boolean | null) => (v === null ? 'skipped' : v ? 'ok' : 'down');
  const checks = { db: tag(db), redis: tag(redis), media: tag(media) } as HealthResult['checks'];
  return { ok: db && redis !== false && media !== false, checks };
}
