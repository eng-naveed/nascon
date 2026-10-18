import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { JwtClaims } from '../../../core/crypto';
import { pool } from '../../../core/db';
import { AppError, notFound } from '../../../core/errors';
import { attach, scoreMessage } from './hub';

/**
 * WebSocket + SSE endpoints (FR-5.2). Guests may subscribe (read-only); identity is only needed for the
 * personal notification stream and for broadcaster presence on a co-stream.
 *   ws  /ws/matches/:id        live score            sse /api/v1/matches/:id/stream
 *   ws  /ws/chat/:room         chat room             sse /api/v1/chat/:room/stream
 *   ws  /ws/costream/:id       session + its chat    (?token=JWT&role=broadcaster marks host presence)
 *   ws  /ws/orders/:id         order status transitions
 *   ws  /ws/notifications      invites etc. for the caller (?token=JWT or Authorization header)
 */
export interface RealtimeOptions {
  /** Verifies a bearer header value; throws the contract's 401 when invalid. */
  authenticate: (header: string | undefined) => JwtClaims;
  /** Called when a broadcaster socket opens on a co-stream; returns the close hook (host handoff, F9). */
  onBroadcaster?: (sessionId: string, user: JwtClaims) => Promise<() => void>;
}

export const HEARTBEAT_MS = 15_000;
const ID = /^[A-Za-z0-9_.:\-]{1,128}$/;

type Beat = () => void;
const beats = new Set<Beat>();
setInterval(() => {
  for (const b of beats) b();
}, HEARTBEAT_MS).unref();

const param = (req: FastifyRequest, name: string) => {
  const v = (req.params as Record<string, string>)[name];
  if (!ID.test(v ?? '')) throw new AppError(400, 'VALIDATION_ERROR', 'Invalid id.', { fields: [name] });
  return v;
};
const bearer = (req: FastifyRequest) => {
  const t = (req.query as Record<string, string>)?.token;
  return t ? `Bearer ${t}` : req.headers.authorization;
};

async function matchExists(id: string) {
  const r = await pool.query('SELECT 1 FROM matches WHERE match_id=$1', [id]);
  if (!r.rowCount) throw notFound('MATCH_NOT_FOUND', `Match ${id} not found.`, { match_id: id });
}
async function sessionRow(id: string) {
  const r = await pool.query(
    'SELECT session_id, status, active_host, participant_count, active_participants, layout, controls FROM costream_sessions WHERE session_id=$1',
    [id],
  );
  if (!r.rowCount) throw notFound('STREAM_NOT_FOUND', `Co-stream ${id} not found.`, { session_id: id });
  return r.rows[0];
}

/** Wires a socket to topics with heartbeats; returns once registered. */
function wire(socket: WebSocket, topics: string[], onClose?: () => void) {
  const detach = attach(topics, (m) => {
    if (socket.readyState === socket.OPEN) socket.send(m);
  });
  let alive = true;
  socket.on('pong', () => (alive = true));
  const beat: Beat = () => {
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  };
  beats.add(beat);
  socket.on('close', () => {
    beats.delete(beat);
    detach();
    onClose?.();
  });
  socket.on('error', () => socket.terminate());
}

const send = (socket: WebSocket, topic: string, payload: object) => socket.send(JSON.stringify({ topic, ...payload }));

/** Server-Sent Events stream on one topic; the first frame is `first` (snapshot). */
function sse(req: FastifyRequest, reply: FastifyReply, topic: string, first: object) {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const write = (m: string) => raw.write(`data: ${m}\n\n`);
  write(JSON.stringify({ topic, ...first }));
  const detach = attach([topic], write);
  const beat: Beat = () => raw.write(': ping\n\n');
  beats.add(beat);
  req.raw.on('close', () => {
    beats.delete(beat);
    detach();
  });
}

/** Register after `@fastify/websocket` at the root (so `injectWS` and the server are shared). */
export async function realtime(app: FastifyInstance, opts: RealtimeOptions) {
  await app.register(async (r) => {
    r.get('/ws/matches/:id', { websocket: true, preValidation: async (req) => matchExists(param(req, 'id')) }, async (socket, req) => {
      const id = param(req, 'id');
      wire(socket, [`match:${id}`]);
      send(socket, `match:${id}`, await scoreMessage(id));
    });

    r.get('/ws/chat/:room', { websocket: true, preValidation: async (req) => void param(req, 'room') }, async (socket, req) => {
      const room = param(req, 'room');
      wire(socket, [`chat:${room}`]);
      const last = await pool.query('SELECT last_seq::int AS n FROM chat_rooms WHERE chat_room_id=$1', [room]);
      send(socket, `chat:${room}`, { type: 'chat.hello', chat_room_id: room, last_seq: last.rows[0]?.n ?? 0 });
    });

    r.get(
      '/ws/costream/:id',
      {
        websocket: true,
        preValidation: async (req) => {
          await sessionRow(param(req, 'id'));
          if ((req.query as Record<string, string>).role === 'broadcaster') opts.authenticate(bearer(req));
        },
      },
      async (socket, req) => {
        const id = param(req, 'id');
        let release: (() => void) | undefined;
        if ((req.query as Record<string, string>).role === 'broadcaster' && opts.onBroadcaster) {
          try {
            release = await opts.onBroadcaster(id, opts.authenticate(bearer(req)));
          } catch (e) {
            const err = e as AppError;
            send(socket, `costream:${id}`, { type: 'error', code: err.code ?? 'FORBIDDEN', message: err.message });
            return socket.close(4403, 'not a live participant');
          }
        }
        wire(socket, [`costream:${id}`, `chat:chat-${id}`], release);
        send(socket, `costream:${id}`, { type: 'costream.state', ...(await sessionRow(id)) });
      },
    );

    r.get('/ws/orders/:id', { websocket: true, preValidation: async (req) => void param(req, 'id') }, (socket, req) => {
      wire(socket, [`order:${param(req, 'id')}`]);
    });

    r.get('/ws/notifications', { websocket: true, preValidation: async (req) => void opts.authenticate(bearer(req)) }, (socket, req) => {
      const u = opts.authenticate(bearer(req));
      const topics = [`user:${u.sub}`, ...(u.player_id ? [`user:${u.player_id}`] : [])];
      wire(socket, topics);
      send(socket, topics[0], { type: 'notifications.hello', user_id: u.sub });
    });

    r.get('/api/v1/matches/:id/stream', async (req, reply) => {
      const id = param(req, 'id');
      await matchExists(id);
      sse(req, reply, `match:${id}`, await scoreMessage(id));
    });

    r.get('/api/v1/chat/:room/stream', async (req, reply) => {
      const room = param(req, 'room');
      const last = await pool.query('SELECT last_seq::int AS n FROM chat_rooms WHERE chat_room_id=$1', [room]);
      sse(req, reply, `chat:${room}`, { type: 'chat.hello', chat_room_id: room, last_seq: last.rows[0]?.n ?? 0 });
    });
  });
}
