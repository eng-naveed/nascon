import { describe, expect, it } from 'vitest';
import { canonical, hashPassword, lotsKey, sign, signJwt, verifyJwt, verifyPassword } from '../src/core/crypto';

describe('signature (Appendix A vectors)', () => {
  it('canonical sorts keys without whitespace', () => {
    expect(canonical({ team_id: 't1', event_type: 'goal' })).toBe('{"event_type":"goal","team_id":"t1"}');
    expect(canonical({ b: [3, { z: 1, a: null }], a: true, ü: 'é' })).toBe('{"a":true,"b":[3,{"a":null,"z":1}],"ü":"é"}');
  });
  it('test vector 1', () => {
    expect(sign('demo-salt', 'evt-1', { team_id: 't1', event_type: 'goal' })).toBe(
      '972a8b558690b19121cc5bea84978f85e8eb15a3735018db36616bab1d7ec501',
    );
  });
  it('test vector 2 (draw lots)', () => {
    expect(lotsKey(42, 'lg-1', 't1')).toBe('0613316991ce0ac31e88d6003e3ff4d5e21bb072ac5f81b42c0cdc6598453293');
    expect(lotsKey(42, 'lg-1', 't2')).toBe('e3e3a14e22727f936e1f288cf5d02a8a9362b1da13c5432725fc10b2c7955dd9');
    expect(lotsKey(42, 'lg-1', 't3')).toBe('c8f28e3c2f1eb6c4f636b4f57050e3362a2b39c07fda9b61742a26dd20397028');
  });
});

describe('jwt', () => {
  const claims = { sub: 'u', role: 'viewer', tenant_id: 'tenant-alpha' };
  it('round trips', () => expect(verifyJwt(signJwt(claims, 's'), 's')?.role).toBe('viewer'));
  it('rejects wrong secret, tamper, alg none, expiry, garbage', () => {
    const t = signJwt(claims, 's');
    expect(verifyJwt(t, 'other')).toBeNull();
    const [h, p, s] = t.split('.');
    expect(verifyJwt(`${h}.${p}.${s.slice(0, -2)}AA`, 's')).toBeNull();
    const none = Buffer.from('{"alg":"none"}').toString('base64url');
    expect(verifyJwt(`${none}.${p}.`, 's')).toBeNull();
    expect(verifyJwt(signJwt(claims, 's', -10), 's')).toBeNull();
    expect(verifyJwt('abc', 's')).toBeNull();
    expect(verifyJwt('a.b.c', 's')).toBeNull();
  });
});

describe('password', () => {
  it('hashes and verifies', () => {
    const h = hashPassword('Nascon@26');
    expect(verifyPassword('Nascon@26', h)).toBe(true);
    expect(verifyPassword('nope', h)).toBe(false);
    expect(verifyPassword('x', 'broken')).toBe(false);
  });
});
