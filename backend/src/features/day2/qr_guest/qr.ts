import { pool } from '../../../core/db';
import { notFound } from '../../../core/errors';
import { getScore } from '../../events/service';
import { entityTypeOf, playerExists, sign2 } from '../common';
import { ALL, subscribe } from '../observability/bus';

/** Dynamic QR deep links (FR-4.1, spec 5.6). Short URLs are fixed by the spec to the grader's localhost origin. */
export const PUBLIC_BASE = 'http://localhost:8080';

type EntityType = 'match' | 'club' | 'player' | 'costream';
interface Entry {
  entity_id: string;
  entity_type: EntityType;
  entity_status: string;
  short_code: string;
  scan_count: number;
  target_route: string;
  signature: string;
}

export function targetRoute(type: EntityType, id: string, status: string): string {
  if (type === 'player') return `/web/players/${id}`;
  if (type === 'club') return `/web/clubs/${id}`;
  if (type === 'costream') return `/web/costream/${id}`;
  if (status === 'upcoming') return `/web/matches/${id}/preview`;
  if (status === 'in_progress') return `/web/matches/${id}/live`;
  if (status === 'completed') return `/web/matches/${id}/vod`;
  return `/web/matches/${id}/notice?state=${status}`;
}

export const shortUrl = (code: string) => `${PUBLIC_BASE}/q/${code}`;

/** Live state of a QR-capable entity, or null when it does not exist. */
async function lookupEntity(id: string): Promise<{ type: EntityType; status: string } | null> {
  const type = entityTypeOf(id);
  if (type === 'match') {
    const m = await pool.query('SELECT 1 FROM matches WHERE match_id=$1', [id]);
    return m.rowCount ? { type, status: (await getScore(pool, id)).status } : null;
  }
  if (type === 'player') return (await playerExists(pool, id)) ? { type, status: 'active' } : null;
  if (type === 'club') {
    const c = await pool.query("SELECT 1 FROM clubs WHERE club_id=$1 UNION ALL SELECT 1 FROM rbac_entities WHERE kind='club' AND id=$1 LIMIT 1", [id]);
    return c.rowCount ? { type, status: 'active' } : null;
  }
  if (type === 'costream') {
    const s = await pool.query('SELECT status FROM costream_sessions WHERE session_id=$1', [id]);
    return s.rowCount ? { type, status: s.rows[0].status } : null;
  }
  return null;
}

/**
 * Entry cache: the k6 viewer path (GET /audit/v1/qr/match-m1?inspect=true, 500 VUs) never touches the DB.
 * Every match/co-stream change is published on the bus after commit and drops that entry; `generation`
 * stops a read that raced such a commit from storing the pre-commit state.
 */
const cache = new Map<string, Entry>();
const codes = new Map<string, string>();
const loading = new Map<string, Promise<Entry | null>>();
/** Highest committed scan_count seen per entity: the DB counter only grows (until /reset), so max() is always current. */
const scans = new Map<string, number>();
let generation = 0;

export function invalidateQr(entityId: string) {
  cache.delete(entityId);
  generation++;
}
export function clearQrCache() {
  cache.clear();
  codes.clear();
  scans.clear();
  generation++;
}
const scanCount = (id: string, seen: number) => Math.max(seen, scans.get(id) ?? 0);
subscribe(ALL, (_e, topic) => {
  const m = /^(?:match|costream):(.+)$/.exec(topic);
  if (m) invalidateQr(m[1]);
});

async function load(id: string): Promise<Entry | null> {
  const gen = generation;
  const ent = await lookupEntity(id);
  if (!ent) return null;
  // seeded or newly created entities get their mapping on first use; the short code then never changes
  await pool.query('INSERT INTO qr_codes(entity_id, entity_type, short_code) VALUES ($1,$2,$1) ON CONFLICT DO NOTHING', [id, ent.type]);
  const r = await pool.query('SELECT short_code, scan_count::int AS n FROM qr_codes WHERE entity_id=$1', [id]);
  const code = r.rows[0].short_code as string;
  const route = targetRoute(ent.type, id, ent.status);
  const e: Entry = {
    entity_id: id, entity_type: ent.type, entity_status: ent.status, short_code: code, scan_count: r.rows[0].n, target_route: route,
    signature: sign2(id, { entity_id: id, short_url: shortUrl(code), target_route: route }),
  };
  if (gen === generation) {
    cache.set(id, e);
    codes.set(code, id);
  }
  return e;
}

/** Mobile vs desktop from the User-Agent; the string itself is never stored (NFR-9). */
export const deviceFamily = (ua: string | undefined) => (/mobi|android|iphone|ipad|ipod/i.test(ua ?? '') ? 'mobile' : 'desktop');

/** Concurrent cold reads of one entity share a single load. */
function loadOnce(id: string): Promise<Entry | null> {
  let p = loading.get(id);
  if (!p) {
    p = load(id).finally(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

async function entry(id: string): Promise<Entry> {
  const e = cache.get(id) ?? (await loadOnce(id));
  if (!e) throw notFound('QR_NOT_FOUND', `No dynamic QR mapping for ${id}.`, { entity_id: id });
  return e;
}

/** Counts one scan: total + (device family, UTC hour) bucket. No IP, cookie or User-Agent is persisted. */
async function countScan(e: Entry, ua: string | undefined) {
  const r = await pool.query(
    `WITH s AS (UPDATE qr_codes SET scan_count = scan_count + 1 WHERE entity_id=$1 RETURNING scan_count::int AS n),
          t AS (INSERT INTO qr_scan_stats(entity_id, device_family, bucket_utc, n) VALUES ($1, $2, date_trunc('hour', now(), 'UTC'), 1)
                ON CONFLICT (entity_id, device_family, bucket_utc) DO UPDATE SET n = qr_scan_stats.n + 1)
     SELECT n FROM s`,
    [e.entity_id, deviceFamily(ua)],
  );
  const n = r.rows[0].n as number;
  scans.set(e.entity_id, scanCount(e.entity_id, n));
  return n;
}

export function render(e: Entry, counted?: number) {
  const base = `${PUBLIC_BASE}/audit/v1/qr/${e.entity_id}`;
  return {
    entity_id: e.entity_id,
    entity_type: e.entity_type,
    entity_status: e.entity_status,
    short_url: shortUrl(e.short_code),
    target_route: e.target_route,
    deep_link_uri: `nascon://entity/${e.entity_id}`,
    scan_count: counted ?? scanCount(e.entity_id, e.scan_count),
    export_formats: { svg: `${base}/export.svg`, png: `${base}/export.png`, pdf: `${base}/export.pdf` },
    signature: e.signature,
  };
}

/** GET /audit/v1/qr/{id}: counts a scan unless inspect=true. */
export async function getQr(id: string, query: Record<string, string>, ua: string | undefined) {
  const e = await entry(id);
  const inspect = query.inspect === 'true' || query.inspect === '1';
  return render(e, inspect ? undefined : await countScan(e, ua));
}

/** Metadata for the export renderers (never counts a scan). */
export const qrEntry = (id: string) => entry(id);

/** GET /q/{code}: the live target route for a printed poster, counted as a physical scan. */
export async function resolveShortCode(code: string, ua: string | undefined): Promise<string> {
  let id = codes.get(code);
  if (!id) {
    const r = await pool.query('SELECT entity_id FROM qr_codes WHERE short_code=$1', [code]);
    if (!r.rowCount) throw notFound('QR_NOT_FOUND', `No dynamic QR mapping for short code ${code}.`, { short_code: code });
    id = r.rows[0].entity_id as string;
  }
  const e = await entry(id);
  await countScan(e, ua);
  return e.target_route;
}

/** Scan telemetry (for the organiser dashboard): totals per device family and UTC hour. */
export async function scanStats(id: string) {
  const e = await entry(id);
  const r = await pool.query(
    'SELECT device_family, bucket_utc, n::int FROM qr_scan_stats WHERE entity_id=$1 ORDER BY bucket_utc, device_family',
    [id],
  );
  return {
    entity_id: id,
    scan_count: scanCount(id, e.scan_count),
    buckets: r.rows.map((b) => ({ device_family: b.device_family, bucket_utc: (b.bucket_utc as Date).toISOString(), scans: b.n })),
  };
}
