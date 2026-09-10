/**
 * Carbonite — public API.
 *
 * Everything here is isomorphic: the same modules run in Node and in the
 * browser build. Node-only persistence lives in `src/node/store.js`.
 */
export { mark, noticeText, DEFAULT_CARRIER } from './core/inject.js';
export { extract } from './core/extract.js';
export { auditDocument, verifySubmission, TOOL_VERSION } from './core/verify.js';
export { reviewPrompt, listRules } from './core/promptGuard.js';
export { listTemplates, getTemplate, renderTemplate, TEMPLATES } from './core/templates.js';
export { listCodecs, getCodec, codecIds, registerCodec, scanAll } from './core/codecs/index.js';
export { listStrategies, resolveOffsets, STRATEGIES } from './core/placement.js';
export { listTransforms, applyTransform, simulate, TRANSFORMS } from './core/transforms.js';
export { listChannels, recommendCodecs, registerChannel, CHANNELS } from './core/channels.js';
export { scanAnomalies } from './core/anomalies.js';
export { sanitize, stripCarbonite, visibleText, normalizeForCompare, HIDDEN_CHARS } from './core/sanitize.js';
export { fingerprint, similarity, containment, findToken } from './core/fingerprint.js';
export { generateKey, keyIdFor, tokenFromNonce } from './core/sign.js';
export { createPayload, describePayload, isExpired, validatePayload } from './core/payload.js';
export {
  addRecord, emptyRegistry, findById, findByFingerprint, findByToken, listRecords,
  recordFor, removeRecord,
} from './core/registry.js';
