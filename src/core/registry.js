/**
 * The record of what was issued.
 *
 * Verification without a registry can still say "this marker is intact and
 * signed by you". Only the registry can say "…and it belongs to Essay 2 in
 * HIST 210, issued on the 3rd, and here is the assignment text it was cut
 * from" — which is the part that matters when a decision has to be explained
 * to someone else.
 *
 * Pure data operations; persistence lives in src/node/store.js.
 */
import { fingerprint } from './fingerprint.js';

export const REGISTRY_VERSION = 1;

export function emptyRegistry() {
  return { version: REGISTRY_VERSION, records: [] };
}

/** Store the assignment text and the prompt separately, as they were authored. */
export async function recordFor({ payload, assignmentText, promptText, carrier, document }) {
  const fp = assignmentText ? await fingerprint(assignmentText) : null;
  return {
    id: payload.id,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    keyId: payload.keyId,
    token: payload.token,
    course: payload.course,
    assignment: payload.assignment,
    teacher: payload.teacher,
    fingerprint: payload.fingerprint || fp?.short,
    disclosed: payload.disclosed,
    prompt: promptText ?? payload.prompt,
    assignmentText: assignmentText ?? undefined,
    assignmentWords: fp?.words,
    carrier: carrier ? { ...carrier } : undefined,
    documentChars: document ? [...document].length : undefined,
  };
}

export function addRecord(registry, record) {
  const next = registry?.records ? { ...registry } : emptyRegistry();
  next.records = [...(next.records || []).filter((r) => r.id !== record.id), record];
  return next;
}

export function removeRecord(registry, id) {
  return { ...registry, records: (registry.records || []).filter((r) => r.id !== id) };
}

export function findById(registry, id) {
  return (registry?.records || []).find((r) => r.id === id) || null;
}

export function findByFingerprint(registry, short) {
  return (registry?.records || []).filter((r) => r.fingerprint && r.fingerprint === short);
}

export function findByToken(registry, token) {
  const needle = String(token || '').toLowerCase();
  return (registry?.records || []).filter((r) => r.token && r.token.toLowerCase() === needle);
}

export function listRecords(registry, { course, includeExpired = true, now = Date.now() } = {}) {
  return (registry?.records || [])
    .filter((r) => (course ? r.course === course : true))
    .filter((r) => (includeExpired ? true : !(r.expiresAt && r.expiresAt * 1000 < now)))
    .sort((a, b) => (b.issuedAt || 0) - (a.issuedAt || 0));
}
