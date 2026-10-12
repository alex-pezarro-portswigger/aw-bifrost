import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import manifest, { createBifrost, resolveSettings, session } from './manifest.js';
import ext from '../index.js';
import { makeLogsDb } from './fixtures/make-logs-db.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function memStore() {
  const m = new Map();
  return {
    get: (k) => (m.has(k) ? { ...m.get(k) } : undefined),
    set: (k, v) => m.set(k, { ...v }),
    copy: (a, b) => (m.has(a) ? (m.set(b, m.get(a)), true) : false),
    delete: (k) => m.delete(k),
  };
}
function fakeHost(settings = {}) {
  const sent = [];
  return { sent, stores: { cards: memStore() }, settings: { all: () => ({ ...settings }), get: (k) => settings[k] }, broadcast: (f) => sent.push(f) };
}
const okFetch = async (u) => ({ ok: true, json: async () => (String(u).endsWith('/health') ? { status: 'ok' } : { data: [{ id: 'gpt-5.5' }, { id: 'claude-opus-4-7' }] }) });
const downFetch = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };

test('manifest shape matches package.json', () => {
  assert.equal(ext, manifest);
  assert.equal(manifest.id, pkg.wranglerExtension.id);
  assert.deepEqual(manifest.requires, pkg.wranglerExtension.requires);
  assert.equal(manifest.engines.wranglerApi, '^1.28.0');
  assert.deepEqual(manifest.hideDispatchField, ['model']);
  const [rt] = manifest.runtimes;
  assert.equal(rt.id, 'bifrost');
  for (const k of ['preflight', 'wrapLaunch', 'cost']) assert.equal(typeof rt[k], 'function', k);
  assert.equal('buildLaunch' in rt, false);
  assert.deepEqual(manifest.handlers.map((h) => h.type), ['bifrost-models', 'bifrost-recent']);
  assert.ok(fs.existsSync(path.join(manifest.dir, manifest.client)));
  assert.ok(fs.existsSync(path.join(manifest.dir, manifest.styles)));
});

test('settings resolve with fallbacks', () => {
  assert.deepEqual(resolveSettings({}), { url: 'http://127.0.0.1:8080', logsDb: null, backgroundModel: 'gpt-5.4-mini', disableBetas: true, noContentLogging: false });
  const r = resolveSettings({ url: 'http://127.0.0.1:8090/', logsDb: '~/x/logs.db', allowBetas: true, noContentLogging: true });
  assert.equal(r.url, 'http://127.0.0.1:8090');
  assert.equal(r.logsDb, path.join(os.homedir(), 'x/logs.db'));
  assert.equal(r.disableBetas, false);
});

test('preflight refuses a non-claude agent, a missing model and an unreachable gateway', async () => {
  const up = createBifrost({ fetchImpl: okFetch });
  const down = createBifrost({ fetchImpl: downFetch });
  const s = { url: 'http://127.0.0.1:8090' };
  assert.equal(await up.preflight({ agent: 'codex', ext: { model: 'gpt-5.5' }, settings: s }), 'Bifrost runtime supports Claude Code sessions only');
  assert.equal(await up.preflight({ agent: 'claude', ext: null, settings: s }), 'Pick an OpenAI model');
  assert.equal(await up.preflight({ agent: 'claude', ext: { model: 'opus' }, settings: s }), 'Pick an OpenAI model');
  assert.match(await down.preflight({ agent: 'claude', ext: { model: 'gpt-5.5' }, settings: s }), /Bifrost isn't reachable at http:\/\/127\.0\.0\.1:8090; start it with scripts\/run-bifrost\.sh/);
  assert.equal(await up.preflight({ agent: 'claude', ext: { model: 'gpt-5.5' }, settings: s }), null);
});

test('dispatch stores the model; wrapLaunch uses it, the parent on fork, and throws with none', async () => {
  const b = createBifrost({ fetchImpl: okFetch });
  const host = fakeHost();
  session.onBeforeDispatch({ sessionId: 'p', ext: { model: 'gpt-5.5' }, host });
  session.onBeforeDispatch({ sessionId: 'q', ext: null, host });
  assert.equal(host.stores.cards.get('q'), undefined);

  const cmd = await b.wrapLaunch({ inner: 'env -u CLAUDECODE claude --model opus', sessionId: 'p', settings: {}, host });
  assert.match(cmd, /ANTHROPIC_DEFAULT_OPUS_MODEL='openai\/gpt-5\.5'/);
  assert.match(cmd, /ANTHROPIC_CUSTOM_HEADERS='x-bf-session-id: p'/);
  assert.match(cmd, /env -u CLAUDECODE claude --model opus$/);

  const forkCmd = await b.wrapLaunch({ inner: 'claude', sessionId: 'f', parentId: 'p', settings: {}, host });
  assert.match(forkCmd, /x-bf-session-id: f'/);
  session.onFork({ sessionId: 'f', parentId: 'p', host });
  assert.deepEqual(host.stores.cards.get('f'), { model: 'gpt-5.5' });

  await assert.rejects(b.wrapLaunch({ inner: 'claude', sessionId: 'nope', settings: {}, host }), /No Bifrost model recorded/);
  session.onPurge({ sessionId: 'p', host });
  assert.equal(host.stores.cards.get('p'), undefined);
});

test('cost reads Bifrost\'s log, null without a path or a matching row', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bifrost-m-'));
  const logsDb = makeLogsDb(path.join(dir, 'logs.db'), [{ sessionId: 'p', cost: 1.5 }, { sessionId: 'live', cost: 0.5 }]);
  const b = createBifrost({ fetchImpl: okFetch });
  assert.deepEqual(await b.cost({ entry: { sessionId: 'p', liveSessionId: 'live' }, settings: { logsDb } }), { usd: 2 });
  assert.equal(await b.cost({ entry: { sessionId: 'x' }, settings: { logsDb } }), null);
  assert.equal(await b.cost({ entry: { sessionId: 'p' }, settings: {} }), null);
  assert.equal(await b.cost({ entry: { sessionId: 'p' }, settings: { logsDb: path.join(dir, 'missing.db') } }), null);
});

test('graph never throws and reports status; handlers broadcast', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bifrost-g-'));
  const logsDb = makeLogsDb(path.join(dir, 'logs.db'), [{ sessionId: 'p', cost: 1 }]);
  const b = createBifrost({ fetchImpl: okFetch });
  const host = fakeHost({ logsDb });
  const g1 = b.graph({ host, graph: {} }).bifrost;
  assert.equal(g1.logs.ok, true);
  assert.equal(g1.totalsByModel.length, 1);
  await b.modelsHandler({}, host);
  assert.deepEqual(host.sent.at(-1), { kind: 'models', models: ['gpt-5.5'], stale: false, reachable: true });
  assert.equal(b.graph({ host, graph: {} }).bifrost.reachable, true);
  await b.recentHandler({ limit: 5 }, host);
  assert.equal(host.sent.at(-1).kind, 'recent');
  assert.equal(host.sent.at(-1).rows.length, 1);

  const bad = fakeHost({ logsDb: path.join(dir, 'missing.db') });
  assert.deepEqual(b.graph({ host: bad, graph: {} }).bifrost.logs, { ok: false, reason: 'missing' });
  const broken = { settings: { all: () => { throw new Error('x'); } } };
  assert.equal(b.graph({ host: broken, graph: {} }).bifrost.logs.ok, false);
});
