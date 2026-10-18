import { describe, expect, it } from 'vitest';
import { compositeUrl, handoff } from '../src/features/day2/costream/service';
import { kickPath } from '../src/features/day2/streaming/media';
import { newStreamKey } from '../src/features/day2/streaming/service';

describe('stream keys', () => {
  it('generated keys match ^sk_live_[a-f0-9]{16}$ and are unique', () => {
    const ks = Array.from({ length: 50 }, newStreamKey);
    for (const k of ks) expect(k).toMatch(/^sk_live_[a-f0-9]{16}$/);
    expect(new Set(ks).size).toBe(50);
  });
});

describe('co-stream host handoff (spec 5.5 rule 5)', () => {
  const four = ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'];
  it('no drop keeps the host and everyone', () => {
    expect(handoff('player-alpha-1', four, false)).toEqual({ status: 'active', active_host: 'player-alpha-1', handoff_occurred: false, participant_count: 4, active_participants: four });
  });
  it('a drop promotes the first remaining participant in array order', () => {
    expect(handoff('player-alpha-1', four, true)).toEqual({ status: 'active', active_host: 'player-alpha-2', handoff_occurred: true, participant_count: 3, active_participants: four.slice(1) });
    expect(handoff('player-beta-1', four, true).active_host).toBe('player-alpha-1');
  });
  it('the sole host dropping terminates the session', () => {
    expect(handoff('player-alpha-1', ['player-alpha-1'], true)).toEqual({ status: 'terminated', active_host: null, handoff_occurred: false, participant_count: 0, active_participants: [] });
  });
  it('composite URL follows the media port convention', () => {
    expect(compositeUrl('cs-session-101')).toBe('http://localhost:8888/costream/cs-session-101/index.m3u8');
  });
});

describe('kickPath (MediaMTX control API)', () => {
  const lists: Record<string, { id: string; path: string }[]> = {
    rtmpconns: [{ id: 'r1', path: 'live/sk_a' }, { id: 'r2', path: 'live/sk_b' }],
    webrtcsessions: [{ id: 'w1', path: 'live/sk_a' }],
    rtspsessions: [],
  };
  it('kicks every session on the path across protocols and tolerates failures', async () => {
    const calls: string[] = [];
    const f = async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const kind = /\/v3\/([a-z]+)\//.exec(url)![1];
      if (kind === 'srtconns') throw new Error('disabled');
      return { ok: true, json: async () => ({ items: lists[kind] }) };
    };
    expect(await kickPath('live/sk_a', 'http://media:9997/', f)).toBe(2);
    expect(calls.filter((c) => c.startsWith('POST')).sort()).toEqual([
      'POST http://media:9997/v3/rtmpconns/kick/r1',
      'POST http://media:9997/v3/webrtcsessions/kick/w1',
    ]);
  });
  it('skips kinds whose list call fails and is a no-op without a media server', async () => {
    const f = async () => ({ ok: false, json: async () => ({}) });
    expect(await kickPath('live/sk_a', 'http://media:9997', f)).toBe(0);
    expect(await kickPath('live/sk_a', '')).toBe(0);
  });
});
