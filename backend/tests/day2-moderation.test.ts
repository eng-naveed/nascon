import { describe, expect, it } from 'vitest';
import { DICTIONARY_RAW, classify, fold, isFlood, isProfaneToken, maskProfanity } from '../src/features/day2/moderation/normalize';

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
