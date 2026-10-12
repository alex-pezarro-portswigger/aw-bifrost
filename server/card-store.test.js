import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CardStore } from './card-store.js';

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bifrost-cards-')), 'bifrost', 'cards.json');

test('set/get, fork copy, purge, and a persistence round trip', () => {
  const f = file();
  const s = new CardStore({ file: f });
  assert.equal(s.get('a'), undefined);
  s.set('a', { model: 'gpt-5.5' });
  assert.deepEqual(s.get('a'), { model: 'gpt-5.5' });
  assert.equal(s.copy('a', 'b'), true);
  assert.equal(s.copy('zz', 'c'), false);
  assert.deepEqual(new CardStore({ file: f }).get('b'), { model: 'gpt-5.5' });
  assert.equal(s.delete('a'), true);
  assert.equal(s.delete('a'), false);
  assert.equal(new CardStore({ file: f }).get('a'), undefined);
});

test('refuses a non-OpenAI model', () => {
  assert.throws(() => new CardStore({ file: file() }).set('a', { model: 'opus' }), /OpenAI/);
});

test('defaults under AW_DATA_DIR', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bifrost-dd-'));
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, ['-e', "import('./server/card-store.js').then(m => console.log(new m.CardStore().file))"],
    { env: { ...process.env, AW_DATA_DIR: dir }, encoding: 'utf8' });
  assert.equal(out.trim(), path.join(dir, 'bifrost', 'cards.json'));
});

test('a corrupt file starts empty and logs', () => {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{nope');
  const logs = [];
  assert.equal(new CardStore({ file: f, log: (m) => logs.push(m) }).get('a'), undefined);
  assert.equal(logs.length, 1);
});
