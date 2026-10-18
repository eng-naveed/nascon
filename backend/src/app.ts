import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './core/config';
import { AppError, forbidden, notFound, unauthenticated } from './core/errors';
import { pool, tx } from './core/db';
import { verifyPassword } from './core/crypto';
import { idSchema, parse } from './core/validate';
import { needsBaselineSeed, resetAndSeed } from './core/seed';
import { createSport, listSports } from './features/sports/service';
import { generateFixtures } from './features/fixtures';
import { createLeague, getStandings } from './features/standings/service';
import { appendEvent, getScore } from './features/events/service';
import { history, setupRoster, transfer, rosterVersion } from './features/roster/service';
import { checkout, inventory } from './features/store/service';
import { authenticate, mintToken, probe, rbacMatrix } from './features/rbac/service';
import { offlineSync } from './features/offline/service';
import { getOrder, listQueue, transitionOrder } from './features/orders/service';
import { getGauge, inc, METRICS_CONTENT_TYPE, renderMetrics } from './core/metrics';
import { runHealth } from './core/health';
import { guestWriteRejection } from './features/day2/common';
import { cartMerge } from './features/day2/qr_guest/cart';
import { issueGuestSession } from './features/day2/qr_guest/guest';
import { clearErased, eraseUser, isErased } from './features/day2/qr_guest/privacy';
import { clearQrCache, getQr, qrEntry, render, resolveShortCode, scanStats } from './features/day2/qr_guest/qr';
import { qrPdf, qrPng, qrSvg } from './features/day2/qr_guest/render';
import { mediaAuth, streamKey } from './features/day2/streaming/service';
import { costreamSession } from './features/day2/costream/service';
import { clearModerationCache, moderationProbe } from './features/day2/moderation/service';
import { clearChatState, listChat, moderate, postChat } from './features/day2/moderation/chat';

const hits = new Map<string, number[]>();
function rateLimit(ip: string) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 10_000);
  if (arr.length >= 100) {
    hits.set(ip, arr);
    const retry = Math.max(1, Math.ceil((10_000 - (now - arr[0])) / 1000));
    throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.', {}, { 'Retry-After': String(retry) });
  }
  arr.push(now);
  hits.set(ip, arr);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 10_000)) hits.delete(k);
}, 30_000).unref();

export function buildApp(): FastifyInstance {
  const app = Fastify({
    bodyLimit: 1_048_576,
    logger: false,
    maxParamLength: 4096,
    frameworkErrors: (e, _req, reply) =>
      (reply as any).status(400).send({ error: { code: 'VALIDATION_ERROR', message: e.message, details: { fields: [] } } }),
  });
  const isProbe = (url: string) => url.startsWith('/audit/v1/rbac/');

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const s = (body as string).trim();
    if (s === '') return done(null, {});
    if (s.includes('\\u0000') || s.includes('\u0000')) return isProbe(req.url) ? done(null, {}) : done(new AppError(400, 'VALIDATION_ERROR', 'Request contains unsupported characters.', { fields: [] }), undefined);
    try {
      done(null, JSON.parse(s));
    } catch {
      // authorization probes ignore the body entirely (auth is evaluated first)
      if (isProbe(req.url)) return done(null, {});
      done(new AppError(400, 'VALIDATION_ERROR', 'Malformed JSON body.', { fields: [] }), undefined);
    }
  });
  app.addContentTypeParser('*', (req, _payload, done) => {
    if (isProbe(req.url)) return done(null, {});
    done(new AppError(400, 'VALIDATION_ERROR', 'Unsupported content type; use application/json.', { fields: [] }), undefined);
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof AppError) {
      for (const [k, v] of Object.entries(err.headers)) reply.header(k, v);
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err.code === '23505' && String(err.constraint ?? '').includes('event_id'))
      return reply.status(409).send({ error: { code: 'DUPLICATE_EVENT_ID', message: 'That event id was already used.', details: {} } });
    if (typeof err.code === 'string' && err.code.startsWith('22'))
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Request contains unsupported characters.', details: { fields: [] } } });
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || err.statusCode === 413)
      return reply.status(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.', details: {} } });
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500)
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Malformed request.', details: { fields: [] } } });
    console.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.', details: {} } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.', details: {} } }));

  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/metrics')) return;
    const route = req.routeOptions?.url ?? 'unmatched';
    inc('http_requests_total', { method: req.method, route, status: reply.statusCode });
    inc('http_request_duration_seconds_sum', { route }, reply.elapsedTime / 1000);
    inc('http_request_duration_seconds_count', { route });
  });

  // Phase II zero-trust boundary: an anonymous guest token can never perform a write, whatever the route.
  // Runs before body parsing and validation, so it answers 403 even for empty or malformed bodies.
  app.addHook('onRequest', async (req) => {
    const rejection = guestWriteRejection(req.method, req.url, req.headers.authorization);
    if (rejection) throw rejection;
  });

  app.addHook('onRequest', async (req) => {
    if (/%00/i.test(req.url)) throw new AppError(400, 'VALIDATION_ERROR', 'Request contains unsupported characters.', { fields: [] });
    if (req.url.startsWith('/api/v1/') && !req.url.startsWith('/api/v1/auth/')) rateLimit(req.ip);
  });

  const auth = (req: FastifyRequest) => {
    const u = authenticate(req.headers.authorization);
    // tokens of an erased account stop working immediately (NFR-9)
    if (isErased(u.sub) || (u.player_id && isErased(u.player_id))) throw unauthenticated();
    return u;
  };
  const q = (req: FastifyRequest) => (req.query ?? {}) as Record<string, string>;
  const send = (reply: FastifyReply, r: { status: number; body: unknown }) => reply.status(r.status).send(r.body);

  // ---- health ----
  app.get('/health', async (_req, reply) => {
    const h = await runHealth({
      db: async () => (await pool.query('SELECT 1')).rowCount === 1,
      // Baseline seed present (Phase II markers included); reported separately from DB reachability.
      seed: async () => !(await needsBaselineSeed(pool)),
      redisUrl: config.redisUrl,
      mediaApiUrl: config.mediaApiUrl,
    });
    if (h.ok) return { status: 'ok' };
    reply.header('x-health-checks', JSON.stringify(h.checks));
    return reply.status(503).send({ status: 'unavailable' });
  });

  // ---- Prometheus metrics (text exposition format) ----
  app.get('/metrics', async (_req, reply) => {
    const q = await pool
      .query(
        `SELECT (SELECT count(*) FROM queue_events WHERE processed_at IS NULL)::int AS queue,
                (SELECT count(*) FROM stream_keys WHERE status = 'active')::int AS streams,
                (SELECT count(*) FROM dlq_events)::int AS dlq,
                (SELECT coalesce(sum(scan_count), 0) FROM qr_codes)::int AS scans`,
      )
      .catch(() => null);
    const r = q?.rows[0] ?? { queue: 0, streams: 0, dlq: 0, scans: 0 };
    // Spec 5.9: these five are always emitted, even when zero.
    const body = renderMetrics(
      {
        queue_pending_events: r.queue,
        nascon_active_ws_connections: getGauge('nascon_active_ws_connections'),
        nascon_active_streams_total: r.streams,
        nascon_stream_bitrate_kbps: getGauge('nascon_stream_bitrate_kbps'),
        nascon_dlq_depth: r.dlq,
        nascon_qr_scans_total: r.scans,
      },
      { nascon_active_streams_total: 'gauge', nascon_qr_scans_total: 'counter' },
    );
    return reply.header('content-type', METRICS_CONTENT_TYPE).send(body);
  });

  // ---- autograder contract ----
  const A = '/audit/v1';
  app.post(`${A}/reset`, async (req) => {
    const b = parse(z.object({ seed: z.number().int().optional(), stock: z.record(z.string(), z.number().int().min(0).max(1000000)).optional() }), req.body);
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await tx((c) => resetAndSeed(c, b));
        clearModerationCache();
        clearChatState();
        clearQrCache();
        clearErased();
        return r;
      } catch (e: any) {
        if (attempt < 4 && (e?.code === '40P01' || e?.code === '40001')) {
          await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
  });
  app.post(`${A}/sports`, async (req, reply) => {
    const cfg = await tx((c) => createSport(c, req.body));
    return reply.status(201).send({ sport_id: cfg.sport_id, status: 'created', config: cfg });
  });
  app.post(`${A}/fixtures`, async (req) => generateFixtures(req.body));
  app.post(`${A}/leagues`, async (req, reply) => reply.status(201).send(await tx((c) => createLeague(c, req.body))));
  app.post(`${A}/events`, async (req, reply) => send(reply, await tx((c) => appendEvent(c, req.body))));
  app.get(`${A}/score/:id`, async (req) => getScore(pool, (req.params as any).id));
  app.get(`${A}/standings/:id`, async (req) => getStandings(pool, (req.params as any).id));
  app.post(`${A}/roster/setup`, async (req, reply) => reply.status(201).send(await tx((c) => setupRoster(c, req.body))));
  app.post(`${A}/roster/transfer`, async (req, reply) => send(reply, await tx((c) => transfer(c, req.body))));
  app.get(`${A}/roster/history/:id`, async (req) => tx((c) => history(c, (req.params as any).id, q(req).as_of)));
  app.post(`${A}/checkout`, async (req, reply) => send(reply, await checkout(req.body)));
  app.get(`${A}/inventory/:id`, async (req) => inventory((req.params as any).id));
  app.post(`${A}/rbac-matrix`, async () => rbacMatrix());
  app.post(`${A}/offline-sync`, async (req) => offlineSync(req.body));
  app.post(`${A}/moderation/test`, async (req) => moderationProbe(req.body));

  // ---- dynamic QR deep links, guest cart merge, privacy erasure (Phase II qr_guest) ----
  const ua = (req: FastifyRequest) => req.headers['user-agent'];
  app.get(`${A}/qr/:id`, async (req) => getQr((req.params as any).id, q(req), ua(req)));
  app.get(`${A}/qr/:id/export.svg`, async (req, reply) => {
    const e = await qrEntry((req.params as any).id);
    return reply.header('content-type', 'image/svg+xml').send(await qrSvg(render(e).short_url));
  });
  app.get(`${A}/qr/:id/export.png`, async (req, reply) => {
    const e = await qrEntry((req.params as any).id);
    return reply.header('content-type', 'image/png').send(await qrPng(render(e).short_url));
  });
  app.get(`${A}/qr/:id/export.pdf`, async (req, reply) => {
    const e = await qrEntry((req.params as any).id);
    return reply.header('content-type', 'application/pdf').send(qrPdf(e.entity_id, render(e).short_url, `${e.entity_type} - ${e.entity_status}`));
  });
  app.get('/q/:code', async (req, reply) => {
    const to = await resolveShortCode((req.params as any).code, ua(req));
    return reply.status(302).header('location', to).header('cache-control', 'no-store').send();
  });
  app.post(`${A}/guest/cart-merge`, async (req) => cartMerge(req.body));
  // ---- creator streaming + co-streams (Phase II streaming / costream) ----
  app.post(`${A}/stream/key`, async (req, reply) => send(reply, await streamKey(req.body)));
  app.post(`${A}/costream/session`, async (req, reply) => send(reply, await costreamSession(req.body)));
  // MediaMTX authMethod: http callback (compose network only; not under /api/v1, so never rate limited)
  app.post('/internal/media/auth', async (req) => mediaAuth(req.body));
  app.delete(`${A}/privacy/user/:id`, async (req) => eraseUser((req.params as any).id));

  const probes: [string, string, string, string?][] = [
    ['post', '/rbac/tenants', 'tenants'],
    ['post', '/rbac/leagues/:id/fixtures', 'league-fixtures'],
    ['post', '/rbac/clubs/:id/roster', 'club-roster'],
    ['post', '/rbac/clubs/:id/products', 'club-products'],
    ['patch', '/rbac/players/:id', 'player-patch'],
    ['get', '/rbac/clubs/:id', 'club-get'],
    ['get', '/rbac/platform/config', 'platform-config'],
  ];
  for (const [method, path, name] of probes)
    (app as any)[method](`${A}${path}`, async (req: FastifyRequest) => {
      const u = auth(req);
      return probe(name, u, (req.params as any)?.id);
    });

  app.get('/api/v1/ping', async () => ({ pong: true }));

  // ---- mobile / production routes (/api/v1) ----
  const V = '/api/v1';
  app.post(`${V}/guest/session`, async (_req, reply) => reply.status(201).send(await issueGuestSession()));
  app.get(`${V}/qr/:id/stats`, async (req) => {
    auth(req);
    return scanStats((req.params as any).id);
  });
  // ---- live audience chat (Phase II): guests read, members write ----
  app.post(`${V}/chat`, async (req, reply) => reply.status(201).send(await postChat(auth(req), req.body)));
  app.get(`${V}/chat/:room/messages`, async (req) => listChat((req.params as any).room, q(req)));
  app.post(`${V}/chat/:room/moderation`, async (req) => moderate(auth(req), (req.params as any).room, req.body));
  app.post(`${V}/auth/login`, async (req) => {
    const b = parse(z.object({ email: z.string().min(3).max(200), password: z.string().min(1).max(200) }), req.body);
    const r = await pool.query('SELECT * FROM users WHERE lower(email)=lower($1)', [b.email]);
    const u = r.rows[0];
    if (!u || !verifyPassword(b.password, u.password_hash)) throw new AppError(401, 'UNAUTHENTICATED', 'Incorrect email or password.');
    const t = u.tenant_id ? (await pool.query('SELECT * FROM tenants WHERE tenant_id=$1', [u.tenant_id])).rows[0] : { tenant_id: null, name: 'NaSCon Platform', primary_color: '#14213D', logo_url: null };
    return {
      token: mintToken(u),
      user: { id: u.user_id, email: u.email, name: u.name, role: u.role, tenant_id: u.tenant_id, league_id: u.league_id, club_id: u.club_id, player_id: u.player_id },
      tenant: { id: t.tenant_id, name: t.name, primary_color: t.primary_color, logo_url: t.logo_url },
    };
  });

  const tenantFilter = (u: any) => (u.role === 'super_admin' ? { sql: 'TRUE', args: [] as any[] } : { sql: 'tenant_id = $1', args: [u.tenant_id] });

  app.get(`${V}/leagues`, async (req) => {
    const u = auth(req);
    const f = tenantFilter(u);
    const r = await pool.query(`SELECT league_id, name, sport_id, tenant_id, config FROM leagues WHERE ${f.sql} ORDER BY league_id`, f.args);
    return { leagues: r.rows.map((l) => ({ league_id: l.league_id, name: l.name, sport_id: l.sport_id, tenant_id: l.tenant_id, team_count: l.config.teams.length, qualification_spots: l.config.qualification.spots })) };
  });

  app.get(`${V}/sports`, async (req) => {
    auth(req);
    return { sports: await listSports(pool) };
  });

  app.get(`${V}/fixtures`, async (req) => {
    const u = auth(req);
    const leagueId = q(req).league_id;
    const f = tenantFilter(u);
    const ms = await pool.query(
      `SELECT m.match_id, m.league_id, m.sport_id, m.home_team_id, m.away_team_id, m.scheduled_at, hc.name AS home_name, ac.name AS away_name
         FROM matches m JOIN leagues l ON l.league_id=m.league_id LEFT JOIN clubs hc ON hc.club_id=m.home_team_id LEFT JOIN clubs ac ON ac.club_id=m.away_team_id
        WHERE ${f.sql.replace('tenant_id', 'l.tenant_id')} ${leagueId ? `AND m.league_id = $${f.args.length + 1}` : ''} ORDER BY m.scheduled_at NULLS LAST, m.match_id`,
      leagueId ? [...f.args, leagueId] : f.args,
    );
    const fixtures = [];
    for (const m of ms.rows) {
      const s = await getScore(pool, m.match_id);
      fixtures.push({
        match_id: m.match_id, league_id: m.league_id, sport_id: m.sport_id, home_team_id: m.home_team_id, away_team_id: m.away_team_id,
        home_name: m.home_name ?? m.home_team_id, away_name: m.away_name ?? m.away_team_id, status: s.status, scheduled_at: m.scheduled_at,
        home_score: s.home.score, away_score: s.away.score, version: s.version,
      });
    }
    return { fixtures };
  });

  app.get(`${V}/matches/:id`, async (req) => {
    auth(req);
    const id = (req.params as any).id as string;
    const s = await getScore(pool, id);
    const m = (await pool.query('SELECT showcase FROM matches WHERE match_id=$1', [id])).rows[0];
    const names = await pool.query('SELECT club_id, name FROM clubs WHERE club_id = ANY($1)', [[s.home.team_id, s.away.team_id]]);
    const nm = new Map(names.rows.map((r) => [r.club_id, r.name]));
    return { ...s, home: { ...s.home, name: nm.get(s.home.team_id) ?? s.home.team_id }, away: { ...s.away, name: nm.get(s.away.team_id) ?? s.away.team_id }, showcase: m.showcase ?? null };
  });

  app.post(`${V}/matches/:id/showcase`, async (req) => {
    const u = auth(req);
    if (u.role !== 'super_admin' && u.role !== 'league_organizer') throw forbidden();
    const id = (req.params as any).id as string;
    const b = parse(z.object({ variant_id: idSchema }), req.body);
    const v = await pool.query('SELECT v.variant_id, v.price_minor, p.name FROM variants v JOIN products p ON p.product_id=v.product_id WHERE v.variant_id=$1', [b.variant_id]);
    if (!v.rowCount) throw notFound('VARIANT_NOT_FOUND', 'Variant not found.', { variant_id: b.variant_id });
    const r = await pool.query('UPDATE matches SET showcase=$2 WHERE match_id=$1', [id, JSON.stringify({ variant_id: b.variant_id, product_name: v.rows[0].name, price_minor: v.rows[0].price_minor })]);
    if (!r.rowCount) throw notFound('MATCH_NOT_FOUND', 'Match not found.', { match_id: id });
    return { status: 'pinned' };
  });

  app.get(`${V}/standings/:id`, async (req) => {
    auth(req);
    return getStandings(pool, (req.params as any).id);
  });

  const clubView = async (id: string) => {
    const c = (await pool.query('SELECT * FROM clubs WHERE club_id=$1', [id])).rows[0];
    if (!c) throw notFound('CLUB_NOT_FOUND', `Club ${id} not found.`, { club_id: id });
    const roster = await pool.query(
      `SELECT p.player_id, p.name, p.position, g.role, g.squad_id FROM roster_regs g JOIN roster_players p ON p.player_id=g.player_id JOIN roster_squads s ON s.league_id=g.league_id AND s.squad_id=g.squad_id WHERE s.club_id=$1 ORDER BY p.name`,
      [id],
    );
    return { club_id: c.club_id, name: c.name, tenant_id: c.tenant_id, home_venue: c.venue, social: c.social, history: c.history, staff: c.staff, roster: roster.rows };
  };
  app.get(`${V}/clubs`, async (req) => {
    const u = auth(req);
    const f = tenantFilter(u);
    const r = await pool.query(`SELECT club_id, name, tenant_id FROM clubs WHERE ${f.sql} ORDER BY name`, f.args);
    return { clubs: r.rows };
  });
  app.get(`${V}/clubs/:id`, async (req) => {
    const u = auth(req);
    const v = await clubView((req.params as any).id);
    if (u.role !== 'super_admin' && v.tenant_id !== u.tenant_id) throw forbidden();
    return v;
  });

  app.get(`${V}/store/products`, async (req) => {
    const u = auth(req);
    const f = tenantFilter(u);
    const ps = await pool.query(`SELECT product_id, name, description FROM products WHERE ${f.sql} ORDER BY product_id`, f.args);
    const vs = await pool.query('SELECT variant_id, product_id, label, price_minor, currency, stock FROM variants ORDER BY variant_id');
    return { products: ps.rows.map((p) => ({ ...p, variants: vs.rows.filter((v) => v.product_id === p.product_id).map(({ product_id, ...v }) => v) })) };
  });

  app.post(`${V}/checkout`, async (req, reply) => {
    const u = auth(req);
    return send(reply, await checkout(req.body, { sub: u.sub }));
  });

  app.post(`${V}/events`, async (req, reply) => {
    const u = auth(req);
    if (u.role !== 'super_admin' && u.role !== 'league_organizer') throw forbidden();
    return send(reply, await tx((c) => appendEvent(c, req.body)));
  });

  app.post(`${V}/roster/transfer`, async (req, reply) => {
    const u = auth(req);
    if (u.role !== 'super_admin' && u.role !== 'club_manager') throw forbidden();
    return send(reply, await tx((c) => transfer(c, req.body)));
  });

  app.get(`${V}/roster/history/:id`, async (req) => {
    auth(req);
    return tx((c) => history(c, (req.params as any).id, q(req).as_of));
  });

  app.get(`${V}/roster/:club_id`, async (req) => {
    auth(req);
    const club = (req.params as any).club_id as string;
    const sq = await pool.query('SELECT s.league_id, s.squad_id, s.name, l.window_open, l.window_close FROM roster_squads s JOIN roster_leagues l ON l.league_id=s.league_id WHERE s.club_id=$1', [club]);
    const squads = [];
    for (const s of sq.rows) {
      const ps = await pool.query(
        'SELECT p.player_id, p.name, p.position, g.role FROM roster_regs g JOIN roster_players p ON p.player_id=g.player_id WHERE g.league_id=$1 AND g.squad_id=$2 ORDER BY p.name',
        [s.league_id, s.squad_id],
      );
      squads.push({ squad_id: s.squad_id, name: s.name, players: ps.rows });
    }
    const first = sq.rows[0];
    const others = first
      ? (await pool.query('SELECT squad_id, name FROM roster_squads WHERE league_id=$1 AND (club_id IS DISTINCT FROM $2) ORDER BY name', [first.league_id, club])).rows
      : [];
    return { club_id: club, other_squads: others, league_id: first?.league_id ?? null, transfer_window: first ? { open: first.window_open, close: first.window_close } : null, squads };
  });

  // ---- order lifecycle (FR-2.3) and internal queue inspection ----
  app.get(`${V}/orders/:id`, async (req) => {
    const u = auth(req);
    if (u.role !== 'super_admin' && u.role !== 'league_organizer' && u.role !== 'club_manager') throw forbidden();
    return getOrder((req.params as any).id);
  });
  app.post(`${V}/orders/:id/status`, async (req) => {
    const u = auth(req);
    if (u.role !== 'super_admin') throw forbidden();
    const b = parse(z.object({ status: z.string() }), req.body);
    return transitionOrder((req.params as any).id, b.status, u.sub);
  });
  app.get(`${V}/admin/queue`, async (req) => {
    const u = auth(req);
    if (u.role !== 'super_admin') throw forbidden();
    const n = Math.min(200, Math.max(1, Number(q(req).limit ?? 50) || 50));
    return listQueue(n);
  });

  app.post(`${V}/offline-sync`, async (req) => {
    auth(req);
    return offlineSync(req.body);
  });
  void rosterVersion;

  return app;
}
