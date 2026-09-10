/**
 * Everything hidden in a document that is *not* one of our markers.
 *
 * A verifier that only looks for its own canary is half a tool. This scanner
 * reports the rest: another teacher's marker, a vendor watermark, bidirectional
 * overrides, look-alike letters used to defeat plagiarism matching, and the
 * tell-tale gap of a document that has been scrubbed of formatting characters.
 */
import { scanAll } from './codecs/index.js';
import { describeCodePoint } from './sanitize.js';

/** Latin look-alikes from other scripts, by the letter they imitate. */
const HOMOGLYPHS = new Map(Object.entries({
  а: 'a', с: 'c', е: 'e', о: 'o', р: 'p', х: 'x', у: 'y', і: 'i', ѕ: 's', ј: 'j',
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X',
  ο: 'o', ν: 'v', α: 'a', Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M',
  Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X', ｅ: 'e', ａ: 'a',
}));

const scriptOf = (ch) => {
  if (/\p{Script=Cyrillic}/u.test(ch)) return 'Cyrillic';
  if (/\p{Script=Greek}/u.test(ch)) return 'Greek';
  if (/\p{Script=Latin}/u.test(ch)) return 'Latin';
  return null;
};

/**
 * @returns {{findings: Array, counts: object}} findings are ordered by severity
 */
export function scanAnomalies(text, { knownRuns = [] } = {}) {
  const str = String(text);
  const findings = [];
  const claimed = new Set();
  for (const run of knownRuns) {
    for (let i = run.start; i < run.end; i++) claimed.add(i);
  }

  // 1. Hidden characters that are not part of a marker we recognised.
  const strays = new Map();
  let index = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    const info = describeCodePoint(cp);
    if (info && !claimed.has(index)) {
      const key = `${info.kind}:${info.name}`;
      const entry = strays.get(key) || { ...info, count: 0, firstIndex: index };
      entry.count++;
      strays.set(key, entry);
    }
    index += ch.length;
  }
  for (const stray of strays.values()) {
    const bidi = stray.kind === 'bidi';
    findings.push({
      type: bidi ? 'bidi-control' : 'unclaimed-hidden-characters',
      severity: bidi ? 'high' : stray.count > 8 ? 'medium' : 'low',
      count: stray.count,
      index: stray.firstIndex,
      label: stray.name,
      detail: bidi
        ? `${stray.count} bidirectional control character(s) — text can render in a different order than it is stored.`
        : `${stray.count} invisible ${stray.name} character(s) outside any marker we could read.`,
      advice: bidi
        ? 'Read the raw bytes before quoting this passage; rendered order may not match stored order.'
        : 'Could be a watermark, another marker, or an artefact of the editor the student used.',
    });
  }

  // 2. Runs that look like a carrier but did not parse as a marker.
  for (const run of scanAll(str)) {
    const alreadyKnown = knownRuns.some((k) => k.start === run.start && k.codec === run.codec);
    if (alreadyKnown || run.bytes.length < 4) continue;
    findings.push({
      type: 'unreadable-carrier',
      severity: 'medium',
      index: run.start,
      count: run.bytes.length,
      label: run.codec,
      detail: `A ${run.bytes.length}-byte hidden run in "${run.codec}" form that is not a readable Carbonite marker.`,
      advice: 'Either a damaged marker, a marker from another key/version, or an unrelated tool\'s payload.',
    });
  }

  // 3. Mixed-script words: look-alike letters inside otherwise Latin words.
  const words = str.match(/[\p{L}\p{M}]{2,}/gu) || [];
  const mixed = [];
  for (const word of words) {
    const scripts = new Set();
    let swaps = 0;
    for (const ch of word) {
      const script = scriptOf(ch);
      if (script) scripts.add(script);
      if (HOMOGLYPHS.has(ch)) swaps++;
    }
    if (scripts.size > 1 && swaps > 0) mixed.push(word);
  }
  if (mixed.length) {
    findings.push({
      type: 'mixed-script-words',
      severity: mixed.length > 3 ? 'high' : 'medium',
      count: mixed.length,
      label: 'homoglyph substitution',
      detail: `${mixed.length} word(s) mix scripts using look-alike letters: ${[...new Set(mixed)].slice(0, 6).join(', ')}`,
      advice: 'A common way to defeat text matching. Normalise the submission before comparing it to sources.',
    });
  }

  // 4. Non-standard spaces used where an ordinary space belongs.
  const oddSpaces = (str.match(/[  -   　]/g) || []).length;
  if (oddSpaces > 12) {
    findings.push({
      type: 'unusual-spacing',
      severity: 'low',
      count: oddSpaces,
      label: 'non-standard spaces',
      detail: `${oddSpaces} non-breaking or typographic spaces.`,
      advice: 'Usually just a word processor or a web paste. Only meaningful alongside other findings.',
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.index - b.index);

  return {
    findings,
    counts: findings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }), {}),
  };
}
