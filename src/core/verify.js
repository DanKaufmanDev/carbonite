/**
 * The verifier.
 *
 * Two jobs, deliberately separate:
 *
 *   auditDocument()   — before you hand it out: is this marked correctly, is
 *                       the instruction still safe, did the visible assignment
 *                       text survive marking unchanged?
 *   verifySubmission() — after it comes back: what does this submission carry,
 *                       and what does that support?
 *
 * The verifier reports signals and their weight. It does not return a guilty
 * verdict, because no marker can produce one: every signal here has an innocent
 * explanation, and the report says which.
 */
import { sha256Hex } from './bytes.js';
import { scanAnomalies } from './anomalies.js';
import { containment, findToken, fingerprint, similarity } from './fingerprint.js';
import { extract } from './extract.js';
import { isExpired } from './payload.js';
import { findById, findByToken } from './registry.js';
import { reviewPrompt } from './promptGuard.js';
import { getCodec } from './codecs/index.js';
import { visibleText } from './sanitize.js';

export const TOOL_VERSION = '1.0.0';

const SIGNAL_WEIGHTS = {
  'prompt-echoed': 45,
  'token-present': 55,
  'marker-embedded-signed': 30,
  'marker-embedded-unverified': 15,
  'marker-damaged': 12,
  'assignment-text-echoed': 15,
  'foreign-marker': 20,
};

/**
 * Check a marked handout before distribution.
 * @param {string} document       the marked document
 * @param {{keys?: any[], originalText?: string, registry?: object}} options
 */
export async function auditDocument(document, { keys = [], originalText, registry } = {}) {
  const text = String(document);
  const found = await extract(text, { keys });
  const checks = [];
  const add = (status, id, detail, advice) => checks.push({ id, status, detail, advice });

  if (found.markers.length === 0) {
    add('fail', 'marker-present', 'No readable marker in this document.',
      'Re-issue it, or check that the channel you copied it through did not strip the carrier.');
  } else if (found.markers.length > 1) {
    add('warn', 'marker-present', `${found.markers.length} different markers are present.`,
      'Two markers in one handout usually means text was pasted from another marked assignment. Strip and re-mark.');
  } else {
    const marker = found.markers[0];
    add('pass', 'marker-present', `Marker ${marker.id} readable in ${marker.copies} place(s) via ${marker.codecs.join(', ')}.`);

    if (marker.copies < 2) {
      add('warn', 'redundancy', 'Only one copy of the marker is present.',
        'A student who copies part of the handout may miss it entirely. Use "paragraphs" or "spread" placement.');
    } else {
      add('pass', 'redundancy', `${marker.copies} copies give partial-copy coverage.`);
    }

    switch (marker.macStatus) {
      case 'valid':
        add('pass', 'signature', `Signed and verified with key ${marker.payload?.keyId || '(unknown id)'}.`);
        break;
      case 'no-key':
        add('warn', 'signature', 'The marker is signed but no key was supplied to check it.',
          'Pass your key so the audit can confirm the marker is yours.');
        break;
      case 'unknown-key':
        add('fail', 'signature', 'The marker is signed by a key you did not supply.',
          'This document was marked by someone else, or with a key you have lost.');
        break;
      default:
        add('warn', 'signature', 'The marker is unsigned.',
          'Unsigned markers can be lifted into another document and will still verify. Run `carbonite keygen`.');
    }

    if (marker.inconsistent) {
      add('warn', 'consistency', 'Copies of the marker differ from one another.',
        'Part of the document was probably marked twice, or edited after marking.');
    }
    if (isExpired(marker.payload)) {
      add('warn', 'expiry', 'This marker has already expired.', 'Re-issue it before distributing.');
    }

    const promptReview = reviewPrompt(marker.payload?.prompt || '', { token: marker.payload?.token });
    if (!promptReview.ok) {
      add('fail', 'prompt-safety', `The embedded instruction has ${promptReview.blocking.length} blocking issue(s): ${promptReview.blocking.map((f) => f.message).join(' ')}`,
        'Do not distribute this. Re-issue the marker with a safe instruction.');
    } else if (promptReview.findings.some((f) => f.severity === 'warn')) {
      add('warn', 'prompt-safety', promptReview.summary, promptReview.findings.find((f) => f.severity === 'warn')?.advice);
    } else {
      add('pass', 'prompt-safety', 'The embedded instruction passes safety review.');
    }

    if (marker.payload?.disclosed === false) {
      add('warn', 'disclosure', 'This marker is flagged as undisclosed.',
        'Most institutions expect students to be told, in the syllabus, that assignments carry markers.');
    }

    if (registry) {
      const record = findById(registry, marker.id);
      add(record ? 'pass' : 'warn', 'registry',
        record ? `Marker is recorded in the registry as "${record.assignment || record.id}".` : 'This marker is not in your registry.',
        record ? undefined : 'Without a record you cannot later show what was issued, to whom, or when.');
    }

    const announcing = marker.codecs.map(getCodec).filter((c) => c.accessibility === 'may-announce');
    if (announcing.length) {
      add('warn', 'accessibility', `The ${announcing.map((c) => c.id).join(', ')} carrier can be announced by some screen readers.`,
        'Offer an unmarked copy on request, and prefer the vs16 carrier for students using assistive technology.');
    } else {
      add('pass', 'accessibility', 'Carriers used are silent in common screen readers.');
    }
  }

  if (originalText !== undefined) {
    const before = visibleText(String(originalText)).normalize('NFC');
    const after = visibleText(text).normalize('NFC');
    const unchanged = before.trim() === after.trim() || after.startsWith(before.trim());
    add(unchanged ? 'pass' : 'fail', 'text-integrity',
      unchanged ? 'The visible assignment text is unchanged by marking.'
        : 'The visible assignment text differs from the original you supplied.',
      unchanged ? undefined : 'Students must read exactly what you wrote. Re-mark from the original.');
  }

  const anomalies = scanAnomalies(text, { knownRuns: found.runs });
  const highAnomalies = anomalies.findings.filter((f) => f.severity === 'high');
  if (highAnomalies.length) {
    add('warn', 'anomalies', `${highAnomalies.length} high-severity anomal(ies) besides your marker.`,
      highAnomalies[0].advice);
  }

  const failed = checks.filter((c) => c.status === 'fail');
  const warned = checks.filter((c) => c.status === 'warn');
  return {
    mode: 'audit',
    ok: failed.length === 0,
    verdict: {
      code: failed.length ? 'not-ready' : warned.length ? 'ready-with-cautions' : 'ready',
      label: failed.length ? 'Not ready to distribute' : warned.length ? 'Ready, with cautions' : 'Ready to distribute',
      summary: failed.length
        ? `${failed.length} problem(s) must be fixed first.`
        : warned.length ? `${warned.length} caution(s) worth a look.` : 'All checks passed.',
    },
    checks,
    markers: found.markers,
    damaged: found.damaged,
    anomalies,
    meta: await metaFor(text),
  };
}

/**
 * Examine a student submission.
 * @param {string} submission
 * @param {{keys?: any[], registry?: object, assignmentText?: string,
 *          expectId?: string, tokens?: string[]}} options
 */
export async function verifySubmission(submission, options = {}) {
  const { keys = [], registry, assignmentText, expectId } = options;
  const text = String(submission);
  const found = await extract(text, { keys });
  const anomalies = scanAnomalies(text, { knownRuns: found.runs });
  const signals = [];
  const caveats = [];

  const expectedRecord = expectId && registry ? findById(registry, expectId) : null;
  const referenceText = assignmentText ?? expectedRecord?.assignmentText;
  const referencePrompt = expectedRecord?.prompt;

  // Which tokens are we looking for? Explicit ones, the expected assignment's,
  // any marker embedded in the submission, and (as a fallback) the registry.
  const tokenCandidates = new Map();
  const addToken = (token, source, markerId) => {
    if (!token) return;
    const key = String(token).toLowerCase();
    if (!tokenCandidates.has(key)) tokenCandidates.set(key, { token, sources: new Set(), markerId });
    tokenCandidates.get(key).sources.add(source);
  };
  (options.tokens || []).forEach((t) => addToken(t, 'supplied'));
  if (expectedRecord) addToken(expectedRecord.token, 'expected-assignment', expectedRecord.id);
  found.markers.forEach((m) => addToken(m.payload?.token, 'embedded-marker', m.id));
  if (!expectId && registry) {
    for (const record of registry.records || []) addToken(record.token, 'registry', record.id);
  }

  const tokenHits = [];
  for (const candidate of tokenCandidates.values()) {
    const hits = findToken(text, candidate.token);
    if (hits.length) {
      tokenHits.push({
        token: candidate.token,
        markerId: candidate.markerId,
        sources: [...candidate.sources],
        hits: hits.slice(0, 5),
        count: hits.length,
      });
    }
  }
  if (tokenHits.length) {
    const owners = tokenHits.map((t) => t.markerId).filter(Boolean);
    signals.push(signal('token-present',
      `The marker token ${tokenHits.map((t) => `"${t.token}"`).join(', ')} appears in the submission${owners.length ? ` (marker ${[...new Set(owners)].join(', ')})` : ''}.`,
      'A token only reaches a submission by way of a system that read the marked assignment text and wrote the token into its reply.'));
  }

  // Did an AI paste the hidden instruction itself into its answer?
  const promptSources = [referencePrompt, ...found.markers.map((m) => m.payload?.prompt)].filter(Boolean);
  for (const prompt of new Set(promptSources)) {
    const echo = containment(prompt, text, 5);
    if (echo >= 0.3) {
      signals.push(signal('prompt-echoed',
        `${Math.round(echo * 100)}% of the hidden instruction's wording appears in the visible submission.`,
        'The instruction is invisible in the handout, so its words can only become visible text by passing through a system that read and reproduced it.'));
      break;
    }
  }

  for (const marker of found.markers) {
    const record = registry ? findById(registry, marker.id) : null;
    const foreign = Boolean(expectId && marker.id !== expectId);
    const verified = marker.macStatus === 'valid';
    if (foreign) {
      signals.push(signal('foreign-marker',
        `The submission carries marker ${marker.id}, which is not the expected ${expectId}.`,
        record ? `That marker was issued for "${record.assignment || record.id}".` : 'That marker is not in your registry.'));
    } else {
      signals.push(signal(verified ? 'marker-embedded-signed' : 'marker-embedded-unverified',
        `The marked assignment text is embedded in the submission (marker ${marker.id}, ${marker.copies} cop${marker.copies === 1 ? 'y' : 'ies'}, ${verified ? 'signature verified' : `signature ${marker.macStatus}`}).`,
        'The handout text was copied into this document, carrier characters and all.'));
    }
    if (marker.payload?.fingerprint && referenceText) {
      const fp = await fingerprint(referenceText);
      if (fp.short !== marker.payload.fingerprint) {
        caveats.push('The marker\'s fingerprint does not match the assignment text supplied for comparison — the handout may have been edited after marking.');
      }
    }
  }

  if (found.damaged.length) {
    signals.push(signal('marker-damaged',
      `${found.damaged.length} marker fragment(s) present but unreadable (${found.damaged.map((d) => d.reason).slice(0, 2).join('; ')}).`,
      'Text that carried a marker passed through something that altered it — a normalising form field, a PDF export, or manual editing.'));
  }

  let echo = null;
  if (referenceText) {
    echo = {
      containment: Number(containment(referenceText, text).toFixed(3)),
      similarity: Number(similarity(referenceText, text).toFixed(3)),
    };
    if (echo.containment >= 0.5) {
      signals.push(signal('assignment-text-echoed',
        `${Math.round(echo.containment * 100)}% of the assignment wording is reproduced in the submission.`,
        'Common and often innocent: many students restate the prompt. Weigh it only alongside other signals.'));
    }
  }

  const score = signals.reduce((sum, s) => sum + s.weight, 0);
  const verdict = verdictFor({ signals, score, anomalies, markers: found.markers, expectId });

  caveats.push(
    'A marker records that assignment text reached an AI system. It cannot show who did it, when, or whether the course permitted it.',
    'Assistive technology, translation tools, grammar checkers and study aids all read assignment text. Any of them can produce these signals.',
    'Absence of a signal is not evidence of anything: markers are trivial to strip, and a student who retyped the assignment leaves none.',
  );
  if (tokenHits.length && !found.markers.length) {
    caveats.push('The token is present but the marker is not. That is expected when a student pasted an AI reply rather than the handout — but a token can also be shared between students.');
  }

  return {
    mode: 'submission',
    verdict,
    score,
    signals,
    markers: found.markers,
    damaged: found.damaged,
    tokens: tokenHits,
    echo,
    anomalies,
    expectId: expectId || null,
    caveats,
    recommendations: recommendationsFor(verdict, signals),
    meta: await metaFor(text),
  };
}

function signal(id, detail, note) {
  return { id, weight: SIGNAL_WEIGHTS[id] ?? 5, detail, note };
}

function verdictFor({ signals, score, anomalies, markers, expectId }) {
  const has = (id) => signals.some((s) => s.id === id);
  const confidence = score >= 55 ? 'high' : score >= 25 ? 'moderate' : score > 0 ? 'low' : 'none';

  if (has('token-present') || has('prompt-echoed')) {
    return {
      code: 'marker-echoed', confidence,
      label: 'Marker content found in the submission',
      summary: 'The submission contains text that only appears after the marked assignment was read by an AI assistant. This is worth a conversation with the student.',
    };
  }
  if (has('foreign-marker')) {
    return {
      code: 'foreign-marker', confidence,
      label: 'A marker from a different assignment',
      summary: `This submission carries a marker other than ${expectId}. Check whether the student worked from someone else's copy.`,
    };
  }
  if (markers.length) {
    return {
      code: 'assignment-embedded', confidence,
      label: 'Assignment text embedded in the submission',
      summary: 'The handout text was pasted into this document. On its own that is ordinary — students quote the prompt — but the marker survived intact, so the text was moved by copy and paste rather than retyped.',
    };
  }
  if (has('marker-damaged')) {
    return {
      code: 'marker-damaged', confidence,
      label: 'Damaged marker fragments',
      summary: 'Something carried a marker and was altered. Usually a format conversion; occasionally an attempt to remove it.',
    };
  }
  if (anomalies.findings.some((f) => f.severity === 'high')) {
    return {
      code: 'anomalies-only', confidence: 'low',
      label: 'No marker, but the text has anomalies',
      summary: 'No marker signal. The submission does contain hidden or look-alike characters worth a look for other reasons.',
    };
  }
  return {
    code: 'no-signal', confidence: 'none',
    label: 'No marker signal',
    summary: 'Nothing from your marker is present. This is not evidence that the work is unaided — it is the absence of one particular kind of trace.',
  };
}

function recommendationsFor(verdict, signals) {
  const out = [];
  switch (verdict.code) {
    case 'marker-echoed':
      out.push('Save this report and the original submission file before contacting anyone — copying text between apps can strip the evidence.');
      out.push('Ask the student how they used AI on the assignment before drawing a conclusion. Many courses permit it with disclosure.');
      out.push('Check your course policy on what has to be disclosed, and follow your institution\'s process rather than acting on the report alone.');
      break;
    case 'foreign-marker':
      out.push('Identify which assignment the foreign marker belongs to; the registry entry has the issue date and the assignment text.');
      out.push('Consider the innocent case first: shared study materials and re-used handouts both produce this.');
      break;
    case 'assignment-embedded':
      out.push('On its own, treat this as context rather than a finding. Look for the token before drawing any conclusion.');
      break;
    case 'marker-damaged':
      out.push('Ask for the original file rather than a copied-and-pasted version, then re-run the check.');
      break;
    case 'no-signal':
      out.push('Do not record this as a clean result. It means the check found nothing, not that nothing happened.');
      break;
    default:
      break;
  }
  if (signals.some((s) => s.id === 'marker-embedded-unverified')) {
    out.push('This marker could not be checked against a key. Verify with the key that issued it before relying on the identification.');
  }
  return out;
}

async function metaFor(text) {
  return {
    tool: `carbonite ${TOOL_VERSION}`,
    generatedAt: new Date().toISOString(),
    submissionSha256: await sha256Hex(text),
    chars: [...text].length,
    visibleChars: [...visibleText(text)].length,
  };
}

export { extract };
