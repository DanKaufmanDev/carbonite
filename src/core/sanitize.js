/**
 * Separating what a reader sees from what a document carries.
 *
 * Everything downstream — fingerprints, similarity, "what did the student
 * actually write" — depends on being able to strip carriers reliably, so the
 * character table lives here and only here.
 */
import { isSelector } from './codecs/vs16.js';
import { isTagChar } from './codecs/tags.js';
import { scanAll } from './codecs/index.js';

/** Invisible or format-only characters, with why each one matters. */
export const HIDDEN_CHARS = [
  { cp: 0x00ad, name: 'SOFT HYPHEN', kind: 'format', risk: 'low' },
  { cp: 0x180e, name: 'MONGOLIAN VOWEL SEPARATOR', kind: 'format', risk: 'low' },
  { cp: 0x200b, name: 'ZERO WIDTH SPACE', kind: 'zero-width', risk: 'carrier' },
  { cp: 0x200c, name: 'ZERO WIDTH NON-JOINER', kind: 'zero-width', risk: 'carrier' },
  { cp: 0x200d, name: 'ZERO WIDTH JOINER', kind: 'zero-width', risk: 'carrier' },
  { cp: 0x200e, name: 'LEFT-TO-RIGHT MARK', kind: 'bidi', risk: 'medium' },
  { cp: 0x200f, name: 'RIGHT-TO-LEFT MARK', kind: 'bidi', risk: 'medium' },
  { cp: 0x202a, name: 'LEFT-TO-RIGHT EMBEDDING', kind: 'bidi', risk: 'high' },
  { cp: 0x202b, name: 'RIGHT-TO-LEFT EMBEDDING', kind: 'bidi', risk: 'high' },
  { cp: 0x202c, name: 'POP DIRECTIONAL FORMATTING', kind: 'bidi', risk: 'high' },
  { cp: 0x202d, name: 'LEFT-TO-RIGHT OVERRIDE', kind: 'bidi', risk: 'high' },
  { cp: 0x202e, name: 'RIGHT-TO-LEFT OVERRIDE', kind: 'bidi', risk: 'high' },
  { cp: 0x2060, name: 'WORD JOINER', kind: 'zero-width', risk: 'carrier' },
  { cp: 0x2061, name: 'FUNCTION APPLICATION', kind: 'invisible-math', risk: 'carrier' },
  { cp: 0x2062, name: 'INVISIBLE TIMES', kind: 'invisible-math', risk: 'carrier' },
  { cp: 0x2063, name: 'INVISIBLE SEPARATOR', kind: 'invisible-math', risk: 'carrier' },
  { cp: 0x2064, name: 'INVISIBLE PLUS', kind: 'invisible-math', risk: 'carrier' },
  { cp: 0x2066, name: 'LEFT-TO-RIGHT ISOLATE', kind: 'bidi', risk: 'high' },
  { cp: 0x2067, name: 'RIGHT-TO-LEFT ISOLATE', kind: 'bidi', risk: 'high' },
  { cp: 0x2068, name: 'FIRST STRONG ISOLATE', kind: 'bidi', risk: 'high' },
  { cp: 0x2069, name: 'POP DIRECTIONAL ISOLATE', kind: 'bidi', risk: 'high' },
  { cp: 0x3164, name: 'HANGUL FILLER', kind: 'blank', risk: 'medium' },
  { cp: 0xfeff, name: 'ZERO WIDTH NO-BREAK SPACE', kind: 'zero-width', risk: 'carrier' },
  { cp: 0xffa0, name: 'HALFWIDTH HANGUL FILLER', kind: 'blank', risk: 'medium' },
];

const HIDDEN_BY_CP = new Map(HIDDEN_CHARS.map((c) => [c.cp, c]));

export function describeCodePoint(cp) {
  if (HIDDEN_BY_CP.has(cp)) return HIDDEN_BY_CP.get(cp);
  if (isSelector(cp)) return { cp, name: 'VARIATION SELECTOR', kind: 'variation-selector', risk: 'carrier' };
  if (isTagChar(cp)) return { cp, name: 'UNICODE TAG CHARACTER', kind: 'tag', risk: 'carrier' };
  if (cp >= 0xe000 && cp <= 0xf8ff) return { cp, name: 'PRIVATE USE AREA', kind: 'private-use', risk: 'medium' };
  if (cp >= 0xf0000 && cp <= 0x10fffd) return { cp, name: 'SUPPLEMENTARY PRIVATE USE', kind: 'private-use', risk: 'medium' };
  return null;
}

export function isHiddenCodePoint(cp) {
  return describeCodePoint(cp) !== null;
}

/** The text a human actually reads: every invisible carrier removed. */
export function visibleText(text) {
  let out = '';
  for (const ch of String(text)) {
    if (!isHiddenCodePoint(ch.codePointAt(0))) out += ch;
  }
  return out;
}

/** Remove only Carbonite runs, leaving any other formatting characters alone. */
export function stripCarbonite(text, { codecs } = {}) {
  const runs = scanAll(String(text), codecs ? { codecs } : undefined);
  if (runs.length === 0) return String(text);
  let out = '';
  let cursor = 0;
  for (const run of runs.sort((a, b) => a.start - b.start)) {
    if (run.start < cursor) continue; // overlapping run already removed
    out += String(text).slice(cursor, run.start);
    cursor = run.end;
  }
  return out + String(text).slice(cursor);
}

/**
 * The strongest cleaner: strip Carbonite runs, drop every other hidden
 * character, and normalise. Use it before handing a document to someone who
 * should receive no marker at all.
 */
export function sanitize(text, { normalize = 'NFC' } = {}) {
  const cleaned = visibleText(stripCarbonite(text));
  return normalize ? cleaned.normalize(normalize) : cleaned;
}

/** Whitespace-collapsed visible text — the basis for fingerprints and diffs. */
export function normalizeForCompare(text) {
  return sanitize(text)
    .replace(/[  -   　]/g, ' ')
    .replace(/[\r\n\t ]+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .trim();
}
