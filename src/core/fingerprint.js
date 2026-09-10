/**
 * Identifying an assignment by its visible words.
 *
 * The fingerprint answers "is this marker attached to the document it was
 * issued for?", and the similarity score answers the softer question "how much
 * of the assignment text is sitting inside this submission?" — which is what
 * catches a student who pasted the whole prompt into a chatbot and pasted the
 * answer back.
 */
import { sha256Hex } from './bytes.js';
import { normalizeForCompare } from './sanitize.js';

export const FINGERPRINT_LENGTH = 12;

export async function fingerprint(text) {
  const normalized = normalizeForCompare(text).toLowerCase();
  const hash = await sha256Hex(normalized);
  return { hash, short: hash.slice(0, FINGERPRINT_LENGTH), normalized, words: countWords(normalized) };
}

export async function fingerprintShort(text) {
  return (await fingerprint(text)).short;
}

export function countWords(text) {
  const words = normalizeForCompare(text).split(/\s+/).filter(Boolean);
  return words.length;
}

/** Word n-grams, lower-cased and punctuation-stripped. */
export function shingles(text, size = 4) {
  const words = normalizeForCompare(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
  const set = new Set();
  if (words.length < size) {
    if (words.length) set.add(words.join(' '));
    return set;
  }
  for (let i = 0; i + size <= words.length; i++) set.add(words.slice(i, i + size).join(' '));
  return set;
}

/** Sørensen–Dice over word 4-grams: 0 (nothing shared) to 1 (identical). */
export function similarity(a, b, size = 4) {
  const setA = shingles(a, size);
  const setB = shingles(b, size);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const gram of setA) if (setB.has(gram)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}

/** How much of `needle` appears in `haystack` — asymmetric, 0 to 1. */
export function containment(needle, haystack, size = 4) {
  const setA = shingles(needle, size);
  const setB = shingles(haystack, size);
  if (setA.size === 0) return 0;
  let shared = 0;
  for (const gram of setA) if (setB.has(gram)) shared++;
  return shared / setA.size;
}

/** Case-insensitive, punctuation-tolerant search for the marker token. */
export function findToken(text, token) {
  if (!token) return [];
  // Punctuation in the token is allowed to drift: "amber-slate-42" should still
  // match "amber slate 42". Every non-alphanumeric is replaced, so nothing the
  // caller passes reaches the regex engine as syntax.
  const loose = String(token).trim().replace(/[^\p{L}\p{N}]+/gu, '[^\\p{L}\\p{N}]{0,3}');
  if (!/[\p{L}\p{N}]/u.test(String(token))) return [];
  const re = new RegExp(loose, 'giu');
  const hits = [];
  let match;
  const haystack = normalizeForCompare(text);
  while ((match = re.exec(haystack)) !== null) {
    if (match[0].length === 0) { re.lastIndex++; continue; }
    hits.push({ index: match.index, text: match[0], context: excerpt(haystack, match.index, match[0].length) });
    if (hits.length >= 25) break;
  }
  return hits;
}

export function excerpt(text, index, length, pad = 60) {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + length + pad);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
}
