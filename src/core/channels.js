/**
 * Where a marked assignment is likely to be delivered, and what that does to it.
 *
 * These are starting expectations, not measurements: platforms change without
 * notice. Anything that matters should be confirmed with `carbonite simulate`
 * and, better, one real round-trip through the channel you actually use.
 */

export const CHANNELS = [
  {
    id: 'lms-rich-text',
    label: 'LMS rich-text field (Canvas, Moodle, Blackboard)',
    approximates: ['nfc', 'collapse-whitespace'],
    expect: { vs16: 'likely', zwj2: 'likely', tags: 'unreliable', sentinel: 'certain' },
    note: 'Rich-text editors usually keep formatting characters but may sanitise the tag block.',
  },
  {
    id: 'google-docs',
    label: 'Google Docs / Word (.docx)',
    approximates: ['nfc'],
    expect: { vs16: 'likely', zwj2: 'likely', tags: 'unreliable', sentinel: 'certain' },
    note: 'Copy out of a word processor generally preserves invisible characters.',
  },
  {
    id: 'pdf-handout',
    label: 'PDF handout, copied by the student',
    approximates: ['bmp-only', 'collapse-whitespace'],
    expect: { vs16: 'partial', zwj2: 'likely', tags: 'unlikely', sentinel: 'certain' },
    note: 'PDF text extraction varies wildly. Non-BMP carriers often do not survive; test your own exporter.',
  },
  {
    id: 'plain-email',
    label: 'Plain-text email',
    approximates: ['line-wrap', 'nfc'],
    expect: { vs16: 'likely', zwj2: 'likely', tags: 'unreliable', sentinel: 'certain' },
    note: 'Wrapping is harmless — carriers are not broken by inserted newlines between copies.',
  },
  {
    id: 'printed',
    label: 'Printed on paper',
    approximates: ['retype'],
    expect: { vs16: 'none', zwj2: 'none', tags: 'none', sentinel: 'certain' },
    note: 'Nothing invisible survives paper. Only a visible sentinel carries over, and only if retyped correctly.',
  },
  {
    id: 'ascii-gateway',
    label: 'ASCII-only field or export',
    approximates: ['ascii-only'],
    expect: { vs16: 'none', zwj2: 'none', tags: 'none', sentinel: 'certain' },
    note: 'Anything above U+007F is dropped. Only the ASCII sentinel gets through.',
  },
  {
    id: 'savvy-student',
    label: 'A student who strips invisible characters',
    approximates: ['strip-format'],
    expect: { vs16: 'none', zwj2: 'none', tags: 'none', sentinel: 'certain' },
    note: 'Assume any determined student can do this. Markers detect casual copying, not adversaries.',
  },
];

const RANK = { certain: 4, likely: 3, partial: 2, unreliable: 1, unlikely: 1, none: 0 };

/** Institutions have their own pipelines; they can describe them here. */
export function registerChannel(channel) {
  if (!channel?.id || !channel.expect) throw new Error('a channel needs an id and an "expect" map');
  const existing = CHANNELS.findIndex((c) => c.id === channel.id);
  if (existing >= 0) CHANNELS[existing] = channel;
  else CHANNELS.push(channel);
  return channel;
}

export function listChannels() {
  return CHANNELS;
}

export function getChannel(id) {
  const channel = CHANNELS.find((c) => c.id === id);
  if (!channel) throw new Error(`unknown channel "${id}" (available: ${CHANNELS.map((c) => c.id).join(', ')})`);
  return channel;
}

/**
 * Pick carriers for a set of delivery channels.
 * @param {string[]} channelIds
 * @returns {{codecs: string[], scores: object, notes: string[]}}
 */
export function recommendCodecs(channelIds = ['lms-rich-text']) {
  const channels = channelIds.map(getChannel);
  const scores = {};
  for (const codec of ['vs16', 'zwj2', 'tags', 'sentinel']) {
    scores[codec] = channels.reduce((worst, channel) => Math.min(worst, RANK[channel.expect[codec]] ?? 0), 4);
  }
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const picked = ranked.filter(([, score]) => score >= 3).map(([id]) => id);
  const notes = channels.map((c) => `${c.label}: ${c.note}`);

  if (picked.length === 0) {
    const best = ranked[0];
    notes.unshift(
      best[1] === 0
        ? 'No invisible carrier survives every channel you selected. Use the visible sentinel, or drop the harshest channel.'
        : `No carrier is reliable across all of these channels; "${best[0]}" is the least bad. Consider marking per channel instead.`,
    );
    return { codecs: [best[0]], scores, notes, confident: false };
  }
  // Two carriers with different failure modes beat one strong carrier.
  const codecs = picked.includes('vs16') && picked.includes('zwj2') ? ['vs16', 'zwj2'] : picked.slice(0, 2);
  return { codecs, scores, notes, confident: true };
}
