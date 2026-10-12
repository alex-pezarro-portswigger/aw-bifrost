import test from 'node:test';
import assert from 'node:assert/strict';
import { chatModelIds, createModelCache } from './models.js';

test('keeps chat gpt-* ids, strips the provider prefix, de-duplicates, sorts newest first', () => {
  const body = { data: [{ id: 'openai/gpt-5.5' }, { id: 'gpt-5.5' }, { id: 'gpt-4.1' }, { id: 'claude-opus-4-7' },
    { id: 'gpt-4o-mini-tts' }, { id: 'chatgpt-image-latest' }, { id: 'ft:gpt-4-0613:x' }, { id: 'gpt-10' }, 'gpt-5.4-mini', {}] };
  assert.deepEqual(chatModelIds(body), ['gpt-10', 'gpt-5.5', 'gpt-5.4-mini', 'gpt-4.1']);
  assert.deepEqual(chatModelIds(null), []);
});

test('falls back to the last good list, marked stale', () => {
  const c = createModelCache();
  assert.deepEqual(c.note({ ok: false, error: 'x' }), { models: [], stale: true, reachable: false, error: 'x' });
  assert.deepEqual(c.note({ ok: true, body: { data: [{ id: 'gpt-5.5' }] } }), { models: ['gpt-5.5'], stale: false, reachable: true });
  assert.deepEqual(c.note({ ok: false, error: 'down' }), { models: ['gpt-5.5'], stale: true, reachable: false, error: 'down' });
});
