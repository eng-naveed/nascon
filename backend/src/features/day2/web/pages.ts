import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { pool } from '../../../core/db';
import { getScore } from '../../events/service';
import { playerExists } from '../common';
import { JS } from './client';
import { CSS } from './styles';

/**
 * Guest Web Player (FR-4.2, spec 6.2.2): server-rendered, zero login wall, no build step.
 * /web/matches/{id}/live and /web/costream/{id} carry the nine mandatory data-testid elements.
 */

const ID = /^[A-Za-z0-9_.:\-]{1,128}$/;
const NOTICE_STATES = new Set(['postponed', 'cancelled', 'abandoned']);
const DEFAULT_PIN = 'var-jersey-001-L';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let hlsJs: string | null = null;
const hls = () => (hlsJs ??= readFileSync(require.resolve('hls.js/dist/hls.light.min.js'), 'utf8'));

const SECURITY = {
  'content-security-policy':
    "default-src 'self'; img-src 'self' data:; media-src 'self' blob: http: https:; connect-src 'self' ws: wss: http: https:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

function layout(title: string, body: string, cfg?: object, withVideo = false) {
  const scripts = cfg
    ? `<script type="application/json" id="cfg">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>${withVideo ? '<script src="/web/assets/hls.js" defer></script>' : ''}<script src="/web/assets/app.js" defer></script>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | NaSCon '26 Live</title><link rel="stylesheet" href="/web/assets/app.css"></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="row"><span class="brand">NaSCon '26 LIVE</span><span id="who" class="muted"></span></header>
<main id="main">${body}</main>
<footer>Watching as a guest: no app or account needed. <span id="live-status" role="status" aria-live="polite"></span></footer>
${scripts}</body></html>`;
}

function page(reply: FastifyReply, status: number, html: string) {
  return reply.status(status).headers({ ...SECURITY, 'content-type': 'text/html; charset=utf-8' }).send(html);
}

const notFoundPage = (reply: FastifyReply, what: string) =>
  page(reply, 404, layout('Not found', `<section class="card"><h1>Not found</h1><p>${esc(what)} does not exist or is no longer available.</p><p><a href="/web">Browse live matches</a></p></section>`));

async function pinned(matchId: string | null) {
  const sc = matchId ? (await pool.query('SELECT showcase FROM matches WHERE match_id=$1', [matchId])).rows[0]?.showcase : null;
  const vid = sc?.variant_id ?? DEFAULT_PIN;
  const v = await pool.query(
    'SELECT v.variant_id, v.label, v.price_minor, p.product_id, p.name FROM variants v JOIN products p ON p.product_id=v.product_id WHERE v.variant_id=$1',
    [vid],
  );
  return v.rows[0] ?? { variant_id: DEFAULT_PIN, label: 'Size L', price_minor: 450000, product_id: 'prod-jersey-001', name: 'Alpha Lions Home Jersey' };
}

async function teamNames(ids: string[]) {
  const r = await pool.query('SELECT club_id, name FROM clubs WHERE club_id = ANY($1)', [ids]);
  const m = new Map(r.rows.map((x) => [x.club_id as string, x.name as string]));
  return (id: string) => m.get(id) ?? id;
}

/** Shared engagement column: pinned merch + guest cart + chat + the progressive auth modal. */
function engage(pin: any, room: string) {
  return `<aside class="grid">
<section class="card pin" data-testid="pinned-merch-card" data-product-id="${esc(pin.product_id)}" data-variant-id="${esc(pin.variant_id)}" aria-labelledby="pin-name">
  <h2>Pinned merch</h2>
  <p id="pin-name">${esc(pin.name)}</p><p class="muted">${esc(pin.label)}</p>
  <p class="price" id="pin-price">PKR ${(Number(pin.price_minor) / 100).toFixed(2)}</p>
  <div class="row">
    <button type="button" data-testid="add-to-guest-cart-btn" aria-label="Add ${esc(pin.name)} to cart">Add to cart</button>
    <span class="cart" aria-label="Items in cart"><span aria-hidden="true">Cart</span><span class="cart-badge" data-testid="guest-cart-count" aria-live="polite">0</span></span>
  </div>
  <button type="button" class="secondary" id="checkout-btn">Proceed to checkout</button>
  <p id="cart-summary" class="muted"></p>
</section>
<section class="card" aria-labelledby="chat-h">
  <h2 id="chat-h">Live chat</h2>
  <ul class="chat-log" data-testid="chat-message-list" role="log" aria-live="polite" aria-label="Chat messages" tabindex="0"></ul>
  <form class="chatform" id="chat-form">
    <label for="chat-input">Say something</label>
    <input id="chat-input" type="text" maxlength="500" autocomplete="off" data-testid="chat-input-field" aria-describedby="chat-error">
    <button type="button" data-testid="chat-send-btn">Send</button>
  </form>
  <p id="chat-error" class="err" role="alert"></p>
</section>
</aside>
<div class="modal-bg" data-testid="progressive-auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-h" hidden>
  <div class="dialog">
    <h2 id="auth-h">Log in or register to continue</h2>
    <p class="muted">Chatting and checkout need an account. Your cart and your place in the stream are kept.</p>
    <form id="auth-form">
      <label for="auth-email">Email</label><input id="auth-email" type="email" autocomplete="username" required>
      <label for="auth-password">Password</label><input id="auth-password" type="password" autocomplete="current-password" required>
      <p id="auth-error" class="err" role="alert"></p>
      <div class="row"><button type="submit">Log in and continue</button><button type="button" class="secondary" id="modal-close">Keep watching</button></div>
    </form>
    <p class="muted">New here? Register at the venue desk or in the NaSCon app, then log in.</p>
  </div>
</div>`;
}

function player(label: string) {
  return `<div class="player" data-testid="guest-video-player">
  <video id="video" playsinline muted autoplay controls aria-label="${esc(label)}"></video>
  <div class="placeholder" id="player-msg" aria-live="polite"><span>Connecting to the live stream...</span></div>
</div>`;
}

export async function webRoutes(app: FastifyInstance) {
  app.get('/web/assets/app.css', async (_r, reply) => reply.headers({ 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=300' }).send(CSS));
  app.get('/web/assets/app.js', async (_r, reply) => reply.headers({ 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' }).send(JS));
  app.get('/web/assets/hls.js', async (_r, reply) => reply.headers({ 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' }).send(hls()));

  app.get('/web', async (_req, reply) => {
    const ms = await pool.query('SELECT match_id, home_team_id, away_team_id FROM matches ORDER BY match_id');
    const names = await teamNames(ms.rows.flatMap((m) => [m.home_team_id, m.away_team_id]));
    const items: string[] = [];
    for (const m of ms.rows) {
      const s = await getScore(pool, m.match_id);
      const view = s.status === 'in_progress' ? 'live' : s.status === 'upcoming' ? 'preview' : s.status === 'completed' ? 'vod' : `notice?state=${s.status}`;
      items.push(`<li><a href="/web/matches/${esc(m.match_id)}/${esc(view)}">${esc(names(m.home_team_id))} ${s.home.score} - ${s.away.score} ${esc(names(m.away_team_id))}</a> <span class="status-pill${s.status === 'in_progress' ? ' live' : ''}">${esc(s.status.replace('_', ' '))}</span></li>`);
    }
    return page(reply, 200, layout('Matches', `<section class="card"><h1>Matches</h1><ul class="people">${items.join('')}</ul></section>`));
  });

  app.get('/web/matches/:id/:view', async (req, reply) => {
    const { id, view } = req.params as { id: string; view: string };
    if (!ID.test(id) || !['live', 'preview', 'vod', 'notice'].includes(view)) return notFoundPage(reply, 'This page');
    const exists = await pool.query('SELECT 1 FROM matches WHERE match_id=$1', [id]);
    if (!exists.rowCount) return notFoundPage(reply, `Match ${id}`);
    const s = await getScore(pool, id);
    const name = await teamNames([s.home.team_id, s.away.team_id]);
    const home = esc(name(s.home.team_id));
    const away = esc(name(s.away.team_id));
    const statusPill = `<span id="match-status" class="status-pill${s.status === 'in_progress' ? ' live' : ''}">${esc(s.status.replace('_', ' '))}</span>`;
    const head = `<h1>${home} vs ${away}</h1>`;

    if (view === 'live') {
      const pin = await pinned(id);
      const body = `<div class="grid two"><section class="grid" aria-label="Live match">
  ${player(`Live video: ${name(s.home.team_id)} vs ${name(s.away.team_id)}`)}
  <div class="card"><div class="teams"><span>${home}</span>${statusPill}<span>${away}</span></div>
    <p class="score" data-testid="live-score-banner" role="status" aria-live="polite" aria-label="Live score">${s.home.score} - ${s.away.score}</p>
    ${head}</div>
</section>${engage(pin, `chat-${id}`)}</div>`;
      return page(reply, 200, layout(`${name(s.home.team_id)} vs ${name(s.away.team_id)} live`, body, { kind: 'live', id, room: `chat-${id}`, hls: `/match/${id}/index.m3u8` }, true));
    }
    if (view === 'preview') {
      const m = (await pool.query('SELECT scheduled_at FROM matches WHERE match_id=$1', [id])).rows[0];
      return page(reply, 200, layout(`${name(s.home.team_id)} vs ${name(s.away.team_id)}`, `<section class="card">${head}${statusPill}
  <p>Kick-off: <strong>${esc(m.scheduled_at ?? 'to be announced')}</strong></p><p class="muted">This page switches to the live player when the match starts. Scan the same QR code again then.</p></section>`));
    }
    if (view === 'vod') {
      return page(reply, 200, layout(`${name(s.home.team_id)} vs ${name(s.away.team_id)} replay`, `<section class="card">${head}${statusPill}
  <p class="score" aria-label="Final score">${s.home.score} - ${s.away.score}</p><p class="muted">Full-time. The match replay is published here after the broadcast is archived.</p></section>`));
    }
    const state = String((req.query as Record<string, string>).state ?? s.status);
    const shown = NOTICE_STATES.has(state) ? state : s.status;
    return page(reply, 200, layout(`${name(s.home.team_id)} vs ${name(s.away.team_id)} ${shown}`, `<section class="card">${head}
  <p role="alert">This match has been <strong>${esc(shown.replace('_', ' '))}</strong>.</p><p class="muted">Keep this QR code: it will point to the new fixture or the replay automatically.</p></section>`));
  });

  app.get('/web/costream/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ID.test(id)) return notFoundPage(reply, 'This co-stream');
    const r = await pool.query('SELECT status, active_host, active_participants, participant_count, layout FROM costream_sessions WHERE session_id=$1', [id]);
    if (!r.rowCount) return notFoundPage(reply, `Co-stream ${id}`);
    const cs = r.rows[0];
    const pin = await pinned(null);
    const people = (cs.active_participants as string[])
      .map((p) => `<li${p === cs.active_host ? ' class="host"' : ''}>${esc(p)}${p === cs.active_host ? ' (host)' : ''}</li>`)
      .join('');
    const body = `<div class="grid two"><section class="grid" aria-label="Co-stream">
  ${player(`Co-stream ${id}`)}
  <div class="card"><h1>Co-stream ${esc(id)}</h1>
    <p class="score" data-testid="live-score-banner" role="status" aria-live="polite">${cs.status === 'active' ? `LIVE - ${cs.participant_count} on air` : 'Stream ended'}</p>
    <p class="muted">Layout: <span id="cs-layout">${esc(cs.layout)}</span></p>
    <ul class="people" id="people" aria-label="Broadcasters">${people}</ul></div>
</section>${engage(pin, `chat-${id}`)}</div>`;
    return page(reply, 200, layout(`Co-stream ${id}`, body, { kind: 'costream', id, room: `chat-${id}`, hls: `/costream/${id}/index.m3u8` }, true));
  });

  app.get('/web/players/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ID.test(id) || !(await playerExists(pool, id))) return notFoundPage(reply, `Player ${id}`);
    const r = await pool.query(
      `SELECT coalesce(rp.name, u.name) AS name, rp.position, e.club_id, c.name AS club_name
         FROM (SELECT $1::text AS id) x
         LEFT JOIN roster_players rp ON rp.player_id = x.id
         LEFT JOIN users u ON u.player_id = x.id
         LEFT JOIN rbac_entities e ON e.kind='player' AND e.id = x.id
         LEFT JOIN clubs c ON c.club_id = e.club_id`,
      [id],
    );
    const p = r.rows[0] ?? {};
    return page(reply, 200, layout(p.name ?? id, `<section class="card"><h1>${esc(p.name ?? id)}</h1><dl class="facts">
  <dt>Player id</dt><dd>${esc(id)}</dd><dt>Position</dt><dd>${esc(p.position ?? '-')}</dd>
  <dt>Club</dt><dd>${p.club_id ? `<a href="/web/clubs/${esc(p.club_id)}">${esc(p.club_name ?? p.club_id)}</a>` : '-'}</dd></dl></section>`));
  });

  app.get('/web/clubs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = ID.test(id) ? await pool.query('SELECT name, venue FROM clubs WHERE club_id=$1', [id]) : { rowCount: 0, rows: [] };
    if (!r.rowCount) return notFoundPage(reply, `Club ${id}`);
    const c = r.rows[0];
    return page(reply, 200, layout(c.name, `<section class="card"><h1>${esc(c.name)}</h1><dl class="facts">
  <dt>Club id</dt><dd>${esc(id)}</dd><dt>Home ground</dt><dd>${esc(c.venue?.name ?? '-')}</dd></dl></section>`));
  });
}
