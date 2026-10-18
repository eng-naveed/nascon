import { describe, expect, it } from 'vitest';
import { simulateGuestWrite } from '../src/features/day2/qr_guest/cart';
import { deviceFamily, targetRoute } from '../src/features/day2/qr_guest/qr';
import { qrPdf, qrPng, qrSvg } from '../src/features/day2/qr_guest/render';

describe('QR target routes (spec 5.6 dynamic mutation rule)', () => {
  it.each([
    ['match', 'upcoming', '/web/matches/m/preview'],
    ['match', 'in_progress', '/web/matches/m/live'],
    ['match', 'completed', '/web/matches/m/vod'],
    ['match', 'postponed', '/web/matches/m/notice?state=postponed'],
    ['match', 'cancelled', '/web/matches/m/notice?state=cancelled'],
    ['match', 'abandoned', '/web/matches/m/notice?state=abandoned'],
    ['player', 'active', '/web/players/m'],
    ['club', 'active', '/web/clubs/m'],
    ['costream', 'terminated', '/web/costream/m'],
  ] as const)('%s %s -> %s', (type, status, route) => expect(targetRoute(type, 'm', status)).toBe(route));
});

describe('scan telemetry device family (NFR-9)', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', 'mobile'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0)', 'mobile'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'desktop'],
    [undefined, 'desktop'],
  ])('%s -> %s', (ua, fam) => expect(deviceFamily(ua)).toBe(fam));
});

describe('guest write simulation (spec 5.7 rule 4)', () => {
  it('runs through the real guard: any guest_ token is refused with 403', () => {
    expect(simulateGuestWrite('guest_anon_tok_7721')).toBe(403);
    expect(simulateGuestWrite('guest_custom')).toBe(403);
  });
});

describe('QR exports', () => {
  const url = 'http://localhost:8080/q/m1-live';
  it('SVG starts with <svg and carries the short URL', async () => {
    const s = await qrSvg(url);
    expect(s.startsWith('<svg')).toBe(true);
    expect(s).toContain(`<title>${url}</title>`);
  });
  it('PNG has the 8-byte magic header', async () => {
    expect((await qrPng(url)).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
  it('PDF is a real, uncompressed poster with the entity id and URL as text', () => {
    const b = qrPdf('match-m1', url, 'match - in_progress');
    const t = b.toString('latin1');
    expect(t.startsWith('%PDF-')).toBe(true);
    expect(t).toContain('(match-m1) Tj');
    expect(t).toContain(`(${url}) Tj`);
    expect(t).not.toContain('/FlateDecode');
    expect((t.match(/ re\n/g) ?? []).length).toBeGreaterThan(200); // the module matrix is drawn
    expect(t.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});

describe('erased-account registry', () => {
  it('loads erased ids at startup and clears on reset', async () => {
    const { clearErased, isErased, loadErased } = await import('../src/features/day2/qr_guest/privacy');
    await loadErased({ query: async () => ({ rows: [{ user_id: 'u-gone' }] }) });
    expect([isErased('u-gone'), isErased('u-here')]).toEqual([true, false]);
    clearErased();
    expect(isErased('u-gone')).toBe(false);
  });
});
