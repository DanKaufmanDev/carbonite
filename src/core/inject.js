/**
 * Composing a marked assignment.
 *
 * The two inputs stay in separate objects from the first line to the last:
 * `assignment` is what students read, `prompt` is what an AI reader is told.
 * They are never concatenated — the prompt travels in the carrier, the
 * assignment text is returned byte-for-byte unchanged apart from the inserted
 * carrier characters.
 */
import { getCodec } from './codecs/index.js';
import { fingerprint } from './fingerprint.js';
import { packFrame } from './frame.js';
import { createPayload, toWire, validatePayload } from './payload.js';
import { resolveOffsets } from './placement.js';
import { reviewPrompt } from './promptGuard.js';
import { keyIdFor, coerceSecret, tokenFromNonce } from './sign.js';
import { newNonce } from './payload.js';
import { renderTemplate } from './templates.js';
import { visibleText } from './sanitize.js';

export const DEFAULT_CARRIER = { codecs: ['vs16'], placement: 'spread', copies: 3, seed: 1 };

/**
 * @param {object} input
 * @param {{text: string, title?: string, course?: string, teacher?: string, contact?: string}} input.assignment
 * @param {{text?: string, template?: string, allow?: string[]}} input.prompt
 * @param {{codecs?: string[], placement?: string, copies?: number, seed?: number}} [input.carrier]
 * @param {any} [input.key]         signing key record or secret
 * @param {number} [input.ttlDays]  marker expiry
 * @param {'none'|'footer'} [input.notice]  add a visible disclosure line
 * @returns {Promise<object>} result with `.document` when `.ok`
 */
export async function mark(input = {}) {
  const assignment = { ...(input.assignment || {}) };
  const promptSpec = { ...(input.prompt || {}) };
  const carrier = { ...DEFAULT_CARRIER, ...defined(input.carrier) };
  const warnings = [];

  const text = String(assignment.text ?? '');
  if (text.trim() === '') throw new Error('assignment.text is empty — there is nothing to mark');

  const nonce = input.nonce || newNonce();
  const token = input.token || tokenFromNonce(nonce);

  const vars = {
    token,
    course: assignment.course,
    teacher: assignment.teacher,
    assignment: assignment.title,
    contact: assignment.contact,
  };
  const promptText = promptSpec.text?.trim()
    ? promptSpec.text.replace(/\{\{\s*token\s*\}\}/g, token)
    : renderTemplate(promptSpec.template || 'notice', vars);

  const review = reviewPrompt(promptText, { token, allow: promptSpec.allow || [] });
  if (!review.ok) {
    return { ok: false, review, warnings, reason: 'the AI instruction did not pass safety review' };
  }

  const fp = await fingerprint(text);
  const keyId = input.key ? await keyIdFor(coerceSecret(input.key)) : undefined;

  const payload = createPayload({
    id: input.id,
    nonce,
    token,
    keyId,
    fingerprint: fp.short,
    course: assignment.course,
    assignment: assignment.title,
    teacher: assignment.teacher,
    contact: assignment.contact,
    prompt: promptText,
    ttlDays: input.ttlDays,
    disclosed: input.disclosed !== false,
    meta: review.acknowledged.length ? { overrides: review.acknowledged } : input.meta,
  });

  const errors = validatePayload(payload);
  if (errors.length) return { ok: false, review, warnings, reason: errors.join('; '), errors };

  const frame = await packFrame(toWire(payload), { key: input.key || null });

  if (!input.key) {
    warnings.push('This marker is unsigned: anyone can copy it into another document and it will still verify. Generate a key with `carbonite keygen`.');
  }
  if (payload.disclosed === false) {
    warnings.push('This marker is flagged as undisclosed. Check whether your institution requires students to be told that assignments are marked.');
  }

  // Insert one complete copy per offset per codec, right to left so earlier
  // offsets stay valid.
  const insertions = [];
  let document = text;
  for (const codecId of carrier.codecs) {
    const codec = getCodec(codecId);
    const encoded = codec.encode(frame);
    const offsets = resolveOffsets(document, carrier.placement, {
      copies: carrier.copies,
      seed: carrier.seed,
      needsBaseChar: codec.needsBaseChar,
    });
    for (const offset of [...offsets].sort((a, b) => b - a)) {
      document = document.slice(0, offset) + encoded + document.slice(offset);
      insertions.push({ codec: codecId, offset, chars: [...encoded].length });
    }
    if (codec.visible) {
      warnings.push(`The "${codecId}" carrier is visible to students by design.`);
    }
  }

  let notice = null;
  if (input.notice === 'footer') {
    notice = noticeText(payload);
    document += `\n\n${notice}`;
  }

  const hiddenChars = [...document].length - [...visibleText(document)].length;
  return {
    ok: true,
    document,
    payload,
    token,
    frameBytes: frame.length,
    fingerprint: fp.short,
    insertions,
    notice,
    suggestedNotice: noticeText(payload),
    review,
    warnings,
    stats: {
      assignmentChars: [...text].length,
      documentChars: [...document].length,
      hiddenChars,
      overheadRatio: Number((hiddenChars / Math.max(1, [...text].length)).toFixed(3)),
      copies: insertions.length,
    },
  };
}

/** Callers pass sparse option objects; an explicit undefined must not win. */
function defined(source) {
  return Object.fromEntries(Object.entries(source || {}).filter(([, v]) => v !== undefined));
}

/** A visible line a teacher can paste into a handout or syllabus. */
export function noticeText(payload) {
  const who = payload?.teacher ? ` (${payload.teacher})` : '';
  const contact = payload?.contact ? ` Questions: ${payload.contact}.` : '';
  return `Academic integrity notice: this assignment carries an instructor marker${who} `
    + `so that AI-generated submissions can be identified. Reference ${payload?.id || ''}.${contact}`;
}
