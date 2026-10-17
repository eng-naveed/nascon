import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, boot, call, Ctx, PASSWORD, uniq } from './setup';

let ctx: Ctx;
let admin = '';
let viewer = '';
beforeAll(async () => {
  ctx = await boot('extras');
  const login = async (email: string) => (await call(ctx.app, 'POST', '/api/v1/auth/login', { email, password: PASSWORD })).body.token as string;
  admin = await login('admin@nascon.test');
  viewer = await login('viewer@nascon.test');
});
afterAll(async () => ctx.close());

const buy = async () => {
  const order_id = uniq('ord');
  const r = await call(ctx.app, 'POST', '/audit/v1/checkout', {
    order_id, customer_id: 'c1', items: [{ variant_id: 'var-jersey-001-L', quantity: 1 }], discount_code: null, payment: { token: 'tok_success' },
  });
  expect(r.status).toBe(201);
  return order_id;
};

describe('order lifecycle (FR-2.3) and internal queue', () => {
  it('walks Paid -> Packed -> Shipped -> Delivered and rejects illegal moves', async () => {
    const id = await buy();
    const o = await call(ctx.app, 'GET', `/api/v1/orders/${id}`, undefined, bearer(admin));
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({ order_id: id, state: 'Paid' });
    expect(o.body.allowed_next).toEqual(['Packed', 'Cancelled', 'Refunded']);
    for (const next of ['Packed', 'Shipped', 'Delivered']) {
      const r = await call(ctx.app, 'POST', `/api/v1/orders/${id}/status`, { status: next }, bearer(admin));
      expect([r.status, r.body.state]).toEqual([200, next]);
    }
    const bad = await call(ctx.app, 'POST', `/api/v1/orders/${id}/status`, { status: 'Cancelled' }, bearer(admin));
    expect([bad.status, bad.body.error.code]).toEqual([409, 'ILLEGAL_TRANSITION']);
    expect(bad.body.error.details.allowed).toEqual(['Refunded']);
    const done = await call(ctx.app, 'POST', `/api/v1/orders/${id}/status`, { status: 'Refunded' }, bearer(admin));
    expect(done.body.state).toBe('Refunded');
    expect(done.body.history.map((h: any) => h.to)).toEqual(['Paid', 'Packed', 'Shipped', 'Delivered', 'Refunded']);
    expect(done.body.allowed_next).toEqual([]);
  });

  it('validates input, ids and roles', async () => {
    const id = await buy();
    const url = `/api/v1/orders/${id}/status`;
    expect((await call(ctx.app, 'POST', url, { status: 'Teleported' }, bearer(admin))).body.error.code).toBe('VALIDATION_ERROR');
    expect((await call(ctx.app, 'POST', url, {}, bearer(admin))).status).toBe(400);
    expect((await call(ctx.app, 'POST', '/api/v1/orders/nope/status', { status: 'Packed' }, bearer(admin))).status).toBe(404);
    expect((await call(ctx.app, 'GET', '/api/v1/orders/nope', undefined, bearer(admin))).body.error.code).toBe('ORDER_NOT_FOUND');
    expect((await call(ctx.app, 'POST', url, { status: 'Packed' }, bearer(viewer))).status).toBe(403);
    expect((await call(ctx.app, 'GET', `/api/v1/orders/${id}`, undefined, bearer(viewer))).status).toBe(403);
    expect((await call(ctx.app, 'POST', url, { status: 'Packed' })).status).toBe(401);
    const cancel = await call(ctx.app, 'POST', url, { status: 'Cancelled' }, bearer(admin));
    expect(cancel.body.state).toBe('Cancelled');
    expect((await call(ctx.app, 'POST', url, { status: 'Packed' }, bearer(admin))).status).toBe(409);
  });

  it('queue consumer processes events and the admin view shows them', async () => {
    const id = await buy();
    await call(ctx.app, 'POST', `/api/v1/orders/${id}/status`, { status: 'Packed' }, bearer(admin));
    const before = await call(ctx.app, 'GET', '/api/v1/admin/queue?limit=500', undefined, bearer(admin));
    expect(before.status).toBe(200);
    expect(before.body.events.some((e: any) => e.topic === 'order.status_changed' && e.payload.order_id === id)).toBe(true);
    expect((await call(ctx.app, 'GET', '/api/v1/admin/queue', undefined, bearer(viewer))).status).toBe(403);
    const { processQueueOnce } = await import('../../src/features/orders/service');
    expect(await processQueueOnce()).toBeGreaterThan(0);
    const after = await call(ctx.app, 'GET', '/api/v1/admin/queue?limit=bogus', undefined, bearer(admin));
    expect(after.body.pending).toBe(0);
    expect(after.body.events.every((e: any) => e.processed_at)).toBe(true);
    expect(await processQueueOnce()).toBe(0);
  });
});

describe('/metrics (Prometheus text format)', () => {
  it('exposes request counters, latency, uptime, queue and job metrics', async () => {
    await call(ctx.app, 'GET', '/health');
    await call(ctx.app, 'GET', '/audit/v1/score/does-not-exist');
    const { processQueueOnce } = await import('../../src/features/orders/service');
    await buy();
    await processQueueOnce();
    const m = await call(ctx.app, 'GET', '/metrics');
    expect(m.status).toBe(200);
    expect(String(m.headers['content-type'])).toContain('text/plain');
    expect(m.raw).toMatch(/# TYPE http_requests_total counter/);
    expect(m.raw).toMatch(/http_requests_total\{method="GET",route="\/health",status="200"\} \d+/);
    expect(m.raw).toMatch(/http_requests_total\{method="GET",route="\/audit\/v1\/score\/:id",status="404"\} \d+/);
    expect(m.raw).toMatch(/http_request_duration_seconds_sum\{route="\/health"\} [\d.]+/);
    expect(m.raw).toMatch(/process_uptime_seconds \d+/);
    expect(m.raw).toMatch(/queue_pending_events \d+/);
    expect(m.raw).toMatch(/jobs_processed_total\{topic="order.status_changed"\} \d+/);
    expect(m.raw).not.toContain('route="/metrics"');
  });
});
