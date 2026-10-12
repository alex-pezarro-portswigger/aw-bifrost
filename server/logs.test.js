import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeLogsDb } from './fixtures/make-logs-db.js';
import { readSummary, readRecent, createLogsReader, costForEntry, idsForEntry } from './logs.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bifrost-logs-'));
const file = makeLogsDb(path.join(tmp, 'logs.db'), [
  { sessionId: 'card-A', cost: 0.5, prompt: 100, completion: 10, cached: 50, model: 'gpt-5.5' },
  { sessionId: 'card-A', cost: 0.25, prompt: 10, completion: 1, model: 'gpt-5.4-mini' },
  { sessionId: 'live-B1', cost: 1, prompt: 1, model: 'gpt-5.5' },
  { sessionId: 'live-B0', cost: 2, model: 'gpt-5.5' },
  { sessionId: null, cost: 4, model: 'gpt-5.5', status: 'error', error: 'boom' },
  { sessionId: 'card-A', objectType: 'list_models', model: '', cost: 9 },
]);

test('per-card sums by the header id, list_models excluded', () => {
  const s = readSummary(file);
  assert.equal(s.ok, true);
  assert.deepEqual(costForEntry(s, { sessionId: 'card-A' }), { usd: 0.75 });
});

test('falls back to the live and prior conversation ids', () => {
  const s = readSummary(file);
  assert.deepEqual(costForEntry(s, { sessionId: 'card-B', liveSessionId: 'live-B1', priorLiveSessionIds: ['live-B0'] }), { usd: 3 });
  assert.equal(costForEntry(s, { sessionId: 'nobody' }), null);
  assert.equal(costForEntry({ ok: false }, { sessionId: 'card-A' }), null);
  assert.deepEqual(idsForEntry({ sessionId: 'a', liveSessionId: 'a', priorLiveSessionIds: ['b', null] }), ['a', 'b']);
});

test('totals by model', () => {
  const t = readSummary(file).totalsByModel;
  const big = t.find((r) => r.model === 'gpt-5.5');
  assert.equal(big.requests, 4);
  assert.equal(big.usd, 7.5);
  assert.equal(big.prompt, 101);
  assert.equal(big.cached, 50);
  assert.equal(t.find((r) => r.model === 'gpt-5.4-mini').usd, 0.25);
  assert.equal(t.some((r) => r.model === ''), false);
});

test('recent: newest first, limited, no content columns', () => {
  const r = readRecent(file, 2);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 2);
  assert.ok(r.rows[0].timestamp >= r.rows[1].timestamp);
  const all = readRecent(file).rows;
  assert.equal(all.length, 5);
  assert.ok(!JSON.stringify(all).includes('SECRET PROMPT'));
  assert.equal(all.find((x) => x.status === 'error').error, 'boom');
});

test('a missing file is { ok: false }', () => {
  assert.deepEqual(readSummary(path.join(tmp, 'nope.db')), { ok: false, reason: 'missing' });
  assert.equal(readRecent(path.join(tmp, 'nope.db')).ok, false);
});

test('summary is cached per tick', () => {
  let t = 0;
  let reads = 0;
  const r = createLogsReader({ ttlMs: 1000, now: () => t, read: () => ({ ok: true, n: ++reads }) });
  r.summary('x'); r.summary('x'); r.summary('x');
  assert.equal(reads, 1);
  t = 1500;
  r.summary('x');
  assert.equal(reads, 2);
  r.summary('y');
  assert.equal(reads, 3);
  assert.deepEqual(r.summary(null), { ok: false, reason: 'logs.db path not set' });
});
