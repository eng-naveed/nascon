/**
 * Chat moderation text rules (FR-5.3, spec 5.8): leetspeak normalisation, profanity masking and flood detection.
 * Pure functions, no I/O: the moderation probe and the live chat path share them.
 */

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
const LEET: Record<string, string> = { '@': 'a', '0': 'o', '1': 'i', '3': 'e', $: 's' };

/** Spec minimum dictionary, as written in the spec (normalised below with the same rules as messages). */
export const DICTIONARY_RAW = ['badword', 'bad_word', 'porn', 'scam', 'fuck', 'shit', 'bitch', 'asshole', 'idiot_spam'];

/**
 * Lowercase, drop zero-width characters, apply the leetspeak map, and drop every other non-alphanumeric
 * (the separators _ . / - * and trailing punctuation). `!` is ambiguous in the spec (1/!->i, yet s!c@m must
 * read as scam), so the caller picks how to fold it.
 */
export function fold(token: string, bang: 'i' | ''): string {
  let out = '';
  for (const ch of token.toLowerCase().replace(ZERO_WIDTH, '')) {
    if (ch === '!') out += bang;
    else if (Object.hasOwn(LEET, ch)) out += LEET[ch];
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) out += ch;
  }
  return out;
}

const DICTIONARY = new Set(DICTIONARY_RAW.map((w) => fold(w, 'i')));

/** A token is profane when either reading of `!` folds to a dictionary word exactly (no substring hits: "scampi" is clean). */
export function isProfaneToken(token: string): boolean {
  return DICTIONARY.has(fold(token, 'i')) || DICTIONARY.has(fold(token, ''));
}

/** Replaces every offending whitespace-delimited token with *** in place, keeping all other text byte-for-byte. */
export function maskProfanity(text: string): { text: string; flagged: boolean } {
  let flagged = false;
  const out = text
    .split(/(\s+)/)
    .map((part) => {
      if (!part || /^\s+$/.test(part) || !isProfaneToken(part)) return part;
      flagged = true;
      return '***';
    })
    .join('');
  return { text: out, flagged };
}

/**
 * Flood: >= 4 consecutive identical characters (case-insensitive, whitespace runs ignored) or
 * >= 3 consecutive exclamation/question marks (any mix of ! and ?).
 */
export function isFlood(text: string): boolean {
  const t = text.replace(ZERO_WIDTH, '').toLowerCase();
  return /(\S)\1{3,}/u.test(t) || /[!?]{3,}/.test(t);
}

export type Verdict = { kind: 'clean' } | { kind: 'profanity'; text: string } | { kind: 'flood' };

/** Flood is checked first: a flooded message is dropped whole, so masking it would be moot. */
export function classify(text: string): Verdict {
  if (isFlood(text)) return { kind: 'flood' };
  const m = maskProfanity(text);
  return m.flagged ? { kind: 'profanity', text: m.text } : { kind: 'clean' };
}
