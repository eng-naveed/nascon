import { describe, expect, it } from 'vitest';
import { DICTIONARY_RAW, classify, fold, isFlood, isProfaneToken, maskProfanity } from '../src/features/day2/moderation/normalize';
import { deliverWithRetry, evaluateBatch } from '../src/features/day2/moderation/service';

describe('leetspeak fold', () => {
  it('maps @ 0 1 3 $, lowercases, strips separators and zero-width characters', () => {
    expect(fold('B@D_W0RD', 'i')).toBe('badword');
    expect(fold('p.0.r.n', 'i')).toBe('porn');
    expect(fold('f*u*c*k', 'i')).toBe('fuck');
    expect(fold('a$$h0le', 'i')).toBe('asshole');
    expect(fold('sh1t', 'i')).toBe('shit');
    expect(fold('b​i‌t‍c⁠h﻿', 'i')).toBe('bitch');
    expect(fold('i-d/i.o_t*spam', 'i')).toBe('idiotspam');
  });
  it('folds ! either as i or as a separator', () => {
    expect(fold('s!c@m', 'i')).toBe('sicam');
    expect(fold('s!c@m', '')).toBe('scam');
    expect(fold('sh!t', 'i')).toBe('shit');
  });
});

describe('profanity tokens (spec 5.8 rule 2 examples)', () => {
  it.each(['b@d_w0rd', 'bad_word', 'badword', 'p0rn', 'p.0.r.n', 'sc@m', 's!c@m', 'f*u*c*k', 'a$$h0le', 'idiot_spam', 'SHIT', 'bitch!', 'scam,'])(
    '%s is profane',
    (t) => expect(isProfaneToken(t)).toBe(true),
  );
  it.each(['Clean', 'sports', 'commentary', 'scampi', 'classic', 'now!', 'shitake', 'assassin', 'stream', ''])('%s is clean', (t) =>
    expect(isProfaneToken(t)).toBe(false),
  );
  it.each(['scams', 'bitches', 'a55hole', '5cam', 'fück', 'ѕсаm'])('%s is profane (plural, 5->s, diacritics, Cyrillic look-alikes)', (t) =>
    expect(isProfaneToken(t)).toBe(true),
  );
  it.each(['Scunthorpe', 'pass', 'Scam-free', '3', '10', '1000000', 'fans'])('%s stays clean', (t) => expect(isProfaneToken(t)).toBe(false));
  it('every dictionary entry matches itself', () => {
    for (const w of DICTIONARY_RAW) expect(isProfaneToken(w)).toBe(true);
  });
});

describe('maskProfanity', () => {
  it('reproduces the spec example byte for byte', () => {
    expect(maskProfanity('Watch this illegal stream b@d_w0rd now!')).toEqual({ text: 'Watch this illegal stream *** now!', flagged: true });
  });
  it('masks every offending token and keeps whitespace', () => {
    expect(maskProfanity('sc@m  and\tp0rn here')).toEqual({ text: '***  and\t*** here', flagged: true });
  });
  it('masks the hardened variants and leaves look-alike clean text alone', () => {
    expect(maskProfanity('no scams, bitches or a55hole 5cam fück ѕсаm')).toEqual({ text: 'no *** *** or *** *** *** ***', flagged: true });
    for (const t of ['scampi', 'assassin', 'shitake', 'Scunthorpe', 'classic pass', 'Scam-free zone', '3 goals in 10 mins', '1000000 fans'])
      expect(maskProfanity(t)).toEqual({ text: t, flagged: false });
  });
  it('leaves clean text untouched', () => {
    expect(maskProfanity('Clean sports commentary')).toEqual({ text: 'Clean sports commentary', flagged: false });
  });
});

describe('flood detection (spec 5.8 rule 3)', () => {
  it.each(['GOAL! AAAA!!!', 'aaAA', 'nooooo', 'what???', 'yes!!!', 'really?!?', 'A​AAA'])('%s is flood', (t) => expect(isFlood(t)).toBe(true));
  it.each(['GOAL! AAA', 'what??', 'Clean sports commentary', 'wait    for it', 'b@d_w0rd now!'])('%s is not flood', (t) =>
    expect(isFlood(t)).toBe(false),
  );
});

describe('classify', () => {
  it('flood wins over profanity; profanity carries the masked text; otherwise clean', () => {
    expect(classify('GOAL! AAAA!!!')).toEqual({ kind: 'flood' });
    expect(classify('sc@m!!!')).toEqual({ kind: 'flood' });
    expect(classify('Watch this illegal stream b@d_w0rd now!')).toEqual({ kind: 'profanity', text: 'Watch this illegal stream *** now!' });
    expect(classify('Clean sports commentary')).toEqual({ kind: 'clean' });
  });
});

describe('evaluateBatch (spec 5.8 rules 1-3 + FR-5.3 rate limit)', () => {
  it('reproduces the spec example', () => {
    expect(
      evaluateBatch([
        { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary' },
        { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream b@d_w0rd now!' },
        { message_id: 'msg-3', sender: 'user-flooder', text: 'GOAL! AAAA!!!' },
      ]),
    ).toEqual({
      filtered: [
        { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary', flagged: false, reason: null },
        { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream *** now!', flagged: true, reason: 'profanity_leetspeak' },
      ],
      kicked: ['user-spammer'],
      muted: ['user-flooder'],
      flaggedCount: 1,
    });
  });
  it('de-duplicates users in first-violation order and counts every flagged message', async () => {
    const r = evaluateBatch([
      { message_id: '1', sender: 'b', text: 'sc@m' },
      { message_id: '2', sender: 'a', text: 'p0rn' },
      { message_id: '3', sender: 'b', text: 'f*u*c*k' },
      { message_id: '4', sender: 'c', text: 'zzzz' },
      { message_id: '5', sender: 'a', text: 'ok???' },
    ]);
    expect([r.kicked, r.muted, r.flaggedCount]).toEqual([['b', 'a'], ['c', 'a'], 3]);
  });
  it('rate limits a sender after 3 messages: the rest are dropped and the sender muted', async () => {
    const msgs = [1, 2, 3, 4, 5].map((i) => ({ message_id: `m${i}`, sender: 'fast', text: `hello ${i}` }));
    const r = evaluateBatch([...msgs, { message_id: 'x', sender: 'calm', text: 'hi' }]);
    expect(r.filtered.map((f) => f.message_id)).toEqual(['m1', 'm2', 'm3', 'x']);
    expect([r.kicked, r.muted]).toEqual([[], ['fast']]);
  });
  it('an empty batch is clean', async () => {
    expect(evaluateBatch([])).toEqual({ filtered: [], kicked: [], muted: [], flaggedCount: 0 });
  });
});

describe('deliverWithRetry (FR-5.2 bounded exponential retry)', () => {
  it('gives up after 3 attempts with exponential backoff', async () => {
    const waits: number[] = [];
    const r = await deliverWithRetry(async () => false, { sleep: async (ms) => void waits.push(ms) });
    expect(r).toEqual({ delivered: false, attempts: 3, backoff: [100, 200] });
    expect(waits).toEqual([100, 200]);
  });
  it('stops at the first success and treats a throw as a failed attempt', async () => {
    let n = 0;
    const r = await deliverWithRetry(
      async () => {
        if (++n === 1) throw new Error('down');
        return true;
      },
      { baseDelayMs: 1 },
    );
    expect(r).toEqual({ delivered: true, attempts: 2, backoff: [1] });
  });
});
