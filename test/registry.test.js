import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addRecord, emptyRegistry, findByFingerprint, findById, findByToken, listRecords, recordFor, removeRecord } from '../src/core/registry.js';
import { createPayload } from '../src/core/payload.js';
import { SAMPLE_ASSIGNMENT } from './helpers.js';

const payloadFor = (overrides) => createPayload({ prompt: 'A course integrity marker.', ...overrides });

describe('registry', () => {
  it('stores the assignment text and the instruction separately', async () => {
    const record = await recordFor({
      payload: payloadFor({ assignment: 'Essay 2', course: 'HIST 210' }),
      assignmentText: SAMPLE_ASSIGNMENT,
      promptText: 'A course integrity marker.',
    });
    assert.equal(record.assignmentText, SAMPLE_ASSIGNMENT);
    assert.equal(record.prompt, 'A course integrity marker.');
    assert.ok(record.fingerprint.length === 12);
    assert.ok(record.assignmentWords > 10);
  });

  it('replaces a record with the same id instead of duplicating it', async () => {
    const payload = payloadFor({ assignment: 'Essay 2' });
    let registry = addRecord(emptyRegistry(), await recordFor({ payload, assignmentText: 'a' }));
    registry = addRecord(registry, await recordFor({ payload, assignmentText: 'b' }));
    assert.equal(registry.records.length, 1);
    assert.equal(registry.records[0].assignmentText, 'b');
  });

  it('finds records by id, token and fingerprint', async () => {
    const payload = payloadFor({ assignment: 'Essay 2' });
    const registry = addRecord(emptyRegistry(), await recordFor({ payload, assignmentText: SAMPLE_ASSIGNMENT }));
    assert.equal(findById(registry, payload.id).assignment, 'Essay 2');
    assert.equal(findByToken(registry, payload.token.toUpperCase()).length, 1);
    assert.equal(findByFingerprint(registry, registry.records[0].fingerprint).length, 1);
    assert.equal(findById(registry, 'cbn_missing'), null);
  });

  it('lists newest first and can filter by course', async () => {
    let registry = emptyRegistry();
    registry = addRecord(registry, await recordFor({ payload: payloadFor({ course: 'A', issuedAt: 100 }) }));
    registry = addRecord(registry, await recordFor({ payload: payloadFor({ course: 'B', issuedAt: 200 }) }));
    assert.equal(listRecords(registry)[0].course, 'B');
    assert.equal(listRecords(registry, { course: 'A' }).length, 1);
  });

  it('hides expired markers when asked', async () => {
    const registry = addRecord(emptyRegistry(), await recordFor({
      payload: payloadFor({ issuedAt: 1000, expiresAt: 2000 }),
    }));
    assert.equal(listRecords(registry, { includeExpired: false }).length, 0);
    assert.equal(listRecords(registry).length, 1);
  });

  it('removes a record', async () => {
    const payload = payloadFor({});
    const registry = addRecord(emptyRegistry(), await recordFor({ payload }));
    assert.equal(removeRecord(registry, payload.id).records.length, 0);
  });
});
