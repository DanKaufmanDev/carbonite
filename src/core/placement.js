/**
 * Where copies of the marker go inside the document.
 *
 * Redundancy is the point. A student rarely copies a whole handout — they take
 * a paragraph, or the first two sentences. Spreading complete copies means any
 * surviving fragment still carries a full, verifiable marker.
 */

/** Deterministic PRNG so the same document and seed produce the same output. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A carrier that modifies the preceding character must not land after a space. */
function isBaseCandidate(ch) {
  return Boolean(ch) && !/[\s\p{Cf}]/u.test(ch);
}

/** Nearest index (at or before `index`) whose preceding character can host a run. */
function snapToBase(text, index) {
  let i = Math.min(Math.max(index, 1), text.length);
  while (i > 0 && !isBaseCandidate(text[i - 1])) i--;
  return i;
}

export const STRATEGIES = {
  end: {
    label: 'End of document',
    describe: 'One copy after the final character.',
    offsets: (text) => [text.length],
  },
  start: {
    label: 'After the first word',
    describe: 'One copy immediately after the opening word.',
    offsets: (text) => {
      const match = /\S+/.exec(text);
      return [match ? match.index + match[0].length : text.length];
    },
  },
  paragraphs: {
    label: 'Every paragraph',
    describe: 'A copy at the end of each paragraph — survives partial copying.',
    offsets: (text) => {
      const offsets = [];
      const re = /\n\s*\n|$/g;
      let match;
      while ((match = re.exec(text)) !== null) {
        if (match.index > 0) offsets.push(match.index);
        if (match.index === text.length) break;
        re.lastIndex = match.index + (match[0].length || 1);
      }
      return offsets.length ? offsets : [text.length];
    },
  },
  sentences: {
    label: 'Every few sentences',
    describe: 'A copy after every third sentence. Densest coverage.',
    offsets: (text) => {
      const offsets = [];
      const re = /[.!?]["')\]]?(?=\s|$)/g;
      let match;
      let n = 0;
      while ((match = re.exec(text)) !== null) {
        if (n++ % 3 === 2) offsets.push(match.index + match[0].length);
      }
      if (offsets.length === 0) offsets.push(text.length);
      return offsets;
    },
  },
  spread: {
    label: 'Spread evenly',
    describe: 'Copies at even intervals, snapped to word boundaries.',
    offsets: (text, { copies = 3, seed = 1 } = {}) => {
      const rand = mulberry32(seed);
      const offsets = [];
      const step = text.length / (copies + 1);
      for (let i = 1; i <= copies; i++) {
        const target = Math.round(step * i + (rand() - 0.5) * step * 0.3);
        const wordEnd = text.slice(0, Math.max(1, target)).search(/\S+$/) === -1
          ? target
          : (text.slice(target).search(/\s|$/) + target);
        offsets.push(Math.min(Math.max(wordEnd, 1), text.length));
      }
      return offsets;
    },
  },
};

export function listStrategies() {
  return Object.entries(STRATEGIES).map(([id, s]) => ({ id, label: s.label, describe: s.describe }));
}

/**
 * Resolve insertion offsets for a strategy.
 * @returns {number[]} unique, ascending, valid offsets into `text`
 */
export function resolveOffsets(text, strategy = 'spread', options = {}) {
  const impl = STRATEGIES[strategy];
  if (!impl) {
    throw new Error(`unknown placement "${strategy}" (available: ${Object.keys(STRATEGIES).join(', ')})`);
  }
  let offsets = impl.offsets(String(text), options) || [];
  const { copies = 3, needsBaseChar = false } = options;

  offsets = offsets
    .map((o) => Math.min(Math.max(Math.round(o), 0), text.length))
    .map((o) => (needsBaseChar ? snapToBase(String(text), o) : o))
    .filter((o) => !needsBaseChar || o > 0);

  offsets = [...new Set(offsets)].sort((a, b) => a - b);

  // Honour the requested copy count: thin out or pad at the end.
  if (strategy !== 'spread' && offsets.length > copies && copies > 0) {
    const stride = offsets.length / copies;
    offsets = Array.from({ length: copies }, (_, i) => offsets[Math.floor(i * stride)]);
  }
  if (offsets.length === 0) offsets = [String(text).length];
  return [...new Set(offsets)];
}

export { snapToBase };
