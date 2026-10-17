import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, call, Ctx } from './setup';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await boot('core');
});
afterAll(async () => ctx.close());

describe('health + reset + transport errors', () => {
  it('GET /health is ok once seeded', async () => {
    const r = await call(ctx.app, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('GET /health is 503 when no tenants exist, then reset restores it', async () => {
    await ctx.db.pool.query('TRUNCATE tenants');
    const r = await call(ctx.app, 'GET', '/health');
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ status: 'unavailable' });
    await ctx.reset();
    expect((await call(ctx.app, 'GET', '/health')).status).toBe(200);
  });

  it('POST /audit/v1/reset applies seed and stock', async () => {
    const r = await call(ctx.app, 'POST', '/audit/v1/reset', { seed: 7, stock: { 'var-jersey-001-M': 3 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      status: 'reset_complete', seed: 7, sports: ['football', 'basketball', 'cricket', 'esports'], tenants: ['tenant-alpha', 'tenant-beta'],
      stock: { 'var-jersey-001-M': 3, 'var-jersey-001-L': 5 },
    });
    const inv = await call(ctx.app, 'GET', '/audit/v1/inventory/var-jersey-001-M');
    expect(inv.body).toEqual({ variant_id: 'var-jersey-001-M', stock: 3, reserved: 0 });
    // default seed and stock
    const d = await call(ctx.app, 'POST', '/audit/v1/reset');
    expect(d.body).toMatchObject({ seed: 42, stock: { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 } });
  });

  it('reset rejects invalid bodies with 400', async () => {
    for (const b of [{ seed: 'x' }, { seed: 1.5 }, { stock: { 'var-jersey-001-M': -1 } }]) {
      const r = await call(ctx.app, 'POST', '/audit/v1/reset', b);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('unknown routes are 404 ROUTE_NOT_FOUND', async () => {
    const r = await call(ctx.app, 'GET', '/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('malformed JSON, NUL bytes, %00 urls and wrong content types are 400', async () => {
    const bad = await ctx.app.inject({ method: 'POST', url: '/audit/v1/sports', payload: '{"a":', headers: { 'content-type': 'application/json' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Malformed JSON body.' });

    const nul = await ctx.app.inject({ method: 'POST', url: '/audit/v1/sports', payload: '{"sport_id":"a\\u0000b"}', headers: { 'content-type': 'application/json' } });
    expect(nul.statusCode).toBe(400);
    expect(nul.json().error.message).toMatch(/unsupported characters/);

    const pct = await call(ctx.app, 'GET', '/audit/v1/score/abc%00def');
    expect(pct.status).toBe(400);
    expect(pct.body.error.code).toBe('VALIDATION_ERROR');

    const txt = await ctx.app.inject({ method: 'POST', url: '/audit/v1/sports', payload: '<a/>', headers: { 'content-type': 'application/xml' } });
    expect(txt.statusCode).toBe(400);
    expect(txt.json().error.message).toMatch(/content type/);
  });

  it('an empty JSON body is treated as {}', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/audit/v1/sports', payload: '   ', headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.fields).toEqual(['scoring_model']);
  });

  it('probe routes ignore malformed bodies / content types and authenticate first', async () => {
    for (const [payload, ct] of [['{oops', 'application/json'], ['{"a":"\\u0000"}', 'application/json'], ['<a/>', 'application/xml']]) {
      const r = await ctx.app.inject({ method: 'POST', url: '/audit/v1/rbac/tenants', payload, headers: { 'content-type': ct } });
      expect(r.statusCode).toBe(401);
      expect(r.json().error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('bodies over 1 MB are 413 PAYLOAD_TOO_LARGE', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(1_100_000) });
    const r = await ctx.app.inject({ method: 'POST', url: '/audit/v1/sports', payload: big, headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(413);
    expect(r.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('a malformed request rejected by fastify itself maps to 400', async () => {
    // invalid content-length for the payload -> fastify client error (4xx) -> 400 VALIDATION_ERROR
    const r = await ctx.app.inject({ method: 'POST', url: '/audit/v1/sports', payload: '{}', headers: { 'content-type': 'application/json', 'content-length': '999' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('SQL-injection-like ids never cause a 5xx', async () => {
    const r = await call(ctx.app, 'GET', `/audit/v1/score/${encodeURIComponent("x'; DROP TABLE sports;--")}`);
    expect(r.status).toBeLessThan(500);
    const s = await call(ctx.app, 'POST', '/audit/v1/sports', { sport_id: "x'; DROP TABLE sports;--", scoring_model: 'event' });
    expect(s.status).toBe(400);
    expect((await call(ctx.app, 'GET', '/health')).status).toBe(200);
  });
});
