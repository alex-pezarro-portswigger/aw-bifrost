import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildEnv, buildEnvPrefix, wrapInner, normaliseUrl, VAR_NAMES } from './env.js';

const base = { url: 'http://127.0.0.1:8090/', model: 'gpt-5.5', backgroundModel: 'gpt-5.4-mini', cardId: 'card-1' };

test('buildEnv sets exactly the expected variables', () => {
  const env = buildEnv(base);
  assert.deepEqual(Object.keys(env).sort(), [...VAR_NAMES].sort());
  assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:8090/anthropic');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'bifrost-local');
  for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
    assert.equal(env[k], 'openai/gpt-5.5', k);
  }
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'openai/gpt-5.4-mini');
  assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, 'x-bf-session-id: card-1');
  assert.equal(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, '1');
});

test('toggles: betas allowed, content logging off', () => {
  const env = buildEnv({ ...base, disableBetas: false, noContentLogging: true });
  assert.equal('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS' in env, false);
  assert.equal(env.ANTHROPIC_CUSTOM_HEADERS, 'x-bf-session-id: card-1\nx-bf-disable-content-logging: true');
});

test('refuses invalid ids', () => {
  assert.throws(() => buildEnv({ ...base, model: 'claude-opus-4-7' }), /OpenAI model/);
  assert.throws(() => buildEnv({ ...base, model: "gpt-5'; rm -rf ~" }), /OpenAI model/);
  assert.throws(() => buildEnv({ ...base, backgroundModel: 'gpt $(id)' }), /model id/);
  assert.throws(() => buildEnv({ ...base, cardId: 'a b' }), /card id/);
  assert.throws(() => normaliseUrl('file:///etc/passwd'), /http/);
});

test('hostile values are inert through a real shell', () => {
  const url = "http://127.0.0.1:1/x'$(echo PWNED)`id`\nnext";
  const prefix = buildEnvPrefix({ ...base, url: 'http://127.0.0.1:8090', noContentLogging: true })
    .replace("'http://127.0.0.1:8090/anthropic'", `'${url.replace(/'/g, `'\\''`)}'`);
  const out = execFileSync('/bin/zsh', ['-fc', `${prefix} env`], { env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'dummy-real-key' }, encoding: 'utf8' });
  assert.ok(out.includes(`ANTHROPIC_BASE_URL=${url}`));
  assert.ok(out.includes('ANTHROPIC_CUSTOM_HEADERS=x-bf-session-id: card-1\nx-bf-disable-content-logging: true'));
  assert.ok(!out.includes('ANTHROPIC_API_KEY='), 'real key is unset');
});

test('wrapInner keeps our vars past the adapter\'s env -u scrub', () => {
  const inner = "env -u CLAUDECODE -u CLAUDE_CODE_SUBAGENT_MODEL -u CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS -u CLAUDE_CODE_ENTRYPOINT AW_SESSION_ID='c' sh -c 'env'";
  const cmd = wrapInner(inner, buildEnvPrefix(base));
  assert.match(cmd, /env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT AW_SESSION_ID=/);
  const out = execFileSync('/bin/zsh', ['-fc', cmd], { env: { PATH: process.env.PATH, CLAUDECODE: '1' }, encoding: 'utf8' });
  assert.ok(out.includes('CLAUDE_CODE_SUBAGENT_MODEL=openai/gpt-5.5'));
  assert.ok(out.includes('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1'));
  assert.ok(!out.includes('CLAUDECODE='));
});

test('wrapInner with no env -u head just prefixes', () => {
  assert.equal(wrapInner('claude --x', 'P; '), 'P; claude --x');
  assert.equal(wrapInner('env -u CLAUDE_CODE_SUBAGENT_MODEL claude', 'P; '), 'P; claude');
});
