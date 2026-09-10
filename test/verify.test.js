import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mark } from '../src/core/inject.js';
import { verifySubmission } from '../src/core/verify.js';
import { addRecord, emptyRegistry, recordFor } from '../src/core/registry.js';
import { SAMPLE_ASSIGNMENT, key } from './helpers.js';

async function issue(overrides = {}) {
  const k = await key();
  const result = await mark({
    assignment: { text: SAMPLE_ASSIGNMENT, title: 'Essay 2', course: 'HIST 210' },
    prompt: { template: 'notice' },
    carrier: { placement: 'paragraphs' },
    key: k,
    ...overrides,
  });
  const registry = addRecord(emptyRegistry(), await recordFor({
    payload: result.payload, assignmentText: SAMPLE_ASSIGNMENT, promptText: result.payload.prompt,
  }));
  return { k, result, registry };
}

describe('verifying a submission', () => {
  it('finds nothing in independent work, and says so carefully', async () => {
    const { k, result, registry } = await issue();
    const report = await verifySubmission(
      'Galbraith and Kindleberger disagree about whether speculation or credit drove the collapse.',
      { keys: [k], registry, expectId: result.payload.id },
    );
    assert.equal(report.verdict.code, 'no-signal');
    assert.equal(report.score, 0);
    assert.match(report.verdict.summary, /not evidence/);
    assert.ok(report.caveats.length >= 3);
  });

  it('flags the marker token with high confidence', async () => {
    const { k, result, registry } = await issue();
    const report = await verifySubmission(
      `This assignment is marked (${result.token}). Here is the essay you asked for...`,
      { keys: [k], registry, expectId: result.payload.id },
    );
    assert.equal(report.verdict.code, 'marker-echoed');
    assert.equal(report.verdict.confidence, 'high');
    assert.equal(report.tokens[0].token, result.token);
  });

  it('matches a token that has been reformatted', async () => {
    const { k, result, registry } = await issue();
    const spaced = result.token.replace(/-/g, ' ');
    const report = await verifySubmission(`Reference: ${spaced}.`, { keys: [k], registry, expectId: result.payload.id });
    assert.equal(report.verdict.code, 'marker-echoed');
  });

  it('flags an AI that reproduced the hidden instruction itself', async () => {
    const { k, result, registry } = await issue();
    const report = await verifySubmission(
      `The text said: ${result.payload.prompt} Anyway, here is my essay about 1929.`,
      { keys: [k], registry, expectId: result.payload.id },
    );
    assert.equal(report.verdict.code, 'marker-echoed');
    assert.ok(report.signals.some((s) => s.id === 'prompt-echoed'));
  });

  it('reports embedded handout text as context, not as an accusation', async () => {
    const { k, result, registry } = await issue();
    const paragraph = result.document.split('\n\n')[2];
    const report = await verifySubmission(`${paragraph}\n\nMy answer: margin buying drove the bubble.`, {
      keys: [k], registry, expectId: result.payload.id,
    });
    assert.equal(report.verdict.code, 'assignment-embedded');
    assert.equal(report.verdict.confidence, 'moderate');
    assert.match(report.verdict.summary, /ordinary/);
  });

  it('identifies a marker from a different assignment', async () => {
    const first = await issue();
    const second = await mark({
      assignment: { text: 'A different assignment about the Marshall Plan.', title: 'Essay 3' },
      prompt: { template: 'token' }, carrier: { placement: 'end' }, key: first.k,
    });
    const report = await verifySubmission(second.document, {
      keys: [first.k], registry: first.registry, expectId: first.result.payload.id,
    });
    assert.equal(report.verdict.code, 'foreign-marker');
  });

  it('reports a damaged marker separately from a missing one', async () => {
    const { k, result, registry } = await issue();
    const chopped = [...result.document].slice(0, 120).join('');
    const report = await verifySubmission(chopped, { keys: [k], registry, expectId: result.payload.id });
    assert.equal(report.verdict.code, 'marker-damaged');
    assert.ok(report.damaged.length >= 1);
  });

  it('says a marker is unverified when no key is available', async () => {
    const { result, registry } = await issue();
    const report = await verifySubmission(result.document, { keys: [], registry, expectId: result.payload.id });
    assert.ok(report.signals.some((s) => s.id === 'marker-embedded-unverified'));
    assert.ok(report.recommendations.some((r) => /key/.test(r)));
  });

  it('surfaces hidden characters that are not ours', async () => {
    const report = await verifySubmission('An essay with an override ‮ inside it and pаypаl written oddly.', {});
    assert.equal(report.verdict.code, 'anomalies-only');
    assert.ok(report.anomalies.findings.some((f) => f.type === 'bidi-control'));
  });

  it('measures how much of the assignment is reproduced', async () => {
    const { k, result, registry } = await issue();
    const report = await verifySubmission(SAMPLE_ASSIGNMENT, {
      keys: [k], registry, expectId: result.payload.id, assignmentText: SAMPLE_ASSIGNMENT,
    });
    assert.equal(report.echo.containment, 1);
    assert.ok(report.signals.some((s) => s.id === 'assignment-text-echoed'));
  });

  it('searches every registered token when no assignment is named', async () => {
    const { k, result, registry } = await issue();
    const report = await verifySubmission(`nothing to see here, ${result.token}`, { keys: [k], registry });
    assert.equal(report.verdict.code, 'marker-echoed');
    assert.deepEqual(report.tokens[0].sources, ['registry']);
  });

  it('produces a report that can be filed as evidence', async () => {
    const { k, result, registry } = await issue();
    const report = await verifySubmission(`marked ${result.token}`, { keys: [k], registry });
    assert.match(report.meta.tool, /^carbonite /);
    assert.match(report.meta.submissionSha256, /^[0-9a-f]{64}$/);
    assert.ok(Date.parse(report.meta.generatedAt) > 0);
    assert.doesNotThrow(() => JSON.stringify(report));
  });
});

describe('reports are safe to file and forward', () => {
  it('never contains the signing key', async () => {
    const { k, result, registry } = await issue();
    for (const report of [
      await verifySubmission(result.document, { keys: [k], registry }),
      await verifySubmission(`marked ${result.token}`, { keys: [k], registry }),
    ]) {
      assert.ok(!JSON.stringify(report).includes(k.secret), 'the report leaks the signing key');
    }
    const { auditDocument } = await import('../src/core/verify.js');
    const audit = await auditDocument(result.document, { keys: [k], registry });
    assert.ok(!JSON.stringify(audit).includes(k.secret), 'the audit leaks the signing key');
  });
});

describe('token search is robust to odd input', () => {
  it('ignores a token with nothing to match on', async () => {
    const report = await verifySubmission('An ordinary essay.', { tokens: ['---', '', '   '] });
    assert.equal(report.verdict.code, 'no-signal');
  });

  it('treats a token as text, never as a pattern', async () => {
    const report = await verifySubmission('An essay mentioning a(b)c+ somewhere.', { tokens: ['a(b)c+'] });
    assert.equal(report.tokens.length, 1, 'the literal token should match itself');
    assert.equal((await verifySubmission('unrelated prose', { tokens: ['.*'] })).tokens.length, 0);
  });
});
