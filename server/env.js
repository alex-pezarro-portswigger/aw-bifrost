// Pure: the environment that points one Claude Code launch at Bifrost.
//
// Card attribution (verified against Bifrost v2.2.6): `x-bf-session-id: <id>`
// is stored in logs.session_id and REPLACES Claude Code's own
// x-claude-code-session-id there, so every request a card makes (main loop,
// sub-agents, background haiku-slot calls) lands under the card id and
// survives /clear. `x-bf-lh-<name>` lands in logs.metadata as JSON instead; we
// don't need it.

export const DEFAULT_URL = 'http://127.0.0.1:8080';
export const DEFAULT_BACKGROUND_MODEL = 'gpt-5.4-mini';
// Bifrost runs with enforce_auth_on_inference off; Claude Code just needs a
// token so it stops asking for a login. Never a real key.
export const DUMMY_TOKEN = 'bifrost-local';

export const MODEL_RE = /^[A-Za-z0-9._:-]+$/;
const ID_RE = /^[A-Za-z0-9._:-]+$/;

// The names this module sets. The adapter's inner command begins
// `env -u CLAUDE_CODE_… claude …`, which strips every CLAUDE_CODE_* the server
// itself happens to carry; `wrapInner` drops ours from that list.
export const VAR_NAMES = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
];

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// `http(s)://host[:port]` with no trailing slash, or throws.
export function normaliseUrl(raw) {
  const text = String(raw || DEFAULT_URL).trim();
  let u;
  try { u = new URL(text); } catch { throw new Error(`Bifrost URL is not a URL: ${text}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Bifrost URL must be http(s): ${text}`);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

export function isOpenAiModel(model) {
  return typeof model === 'string' && model.startsWith('gpt-') && MODEL_RE.test(model);
}

// { name: value } for one launch. Throws on anything that isn't a plain id, as
// defence in depth on top of the quoting.
export function buildEnv({ url, model, backgroundModel, cardId, disableBetas = true, noContentLogging = false, oneMillionContext = true }) {
  if (!isOpenAiModel(model)) throw new Error(`Not an OpenAI model id: ${JSON.stringify(model)}`);
  const bg = backgroundModel || DEFAULT_BACKGROUND_MODEL;
  if (!MODEL_RE.test(bg)) throw new Error(`Not a model id: ${JSON.stringify(bg)}`);
  if (typeof cardId !== 'string' || !ID_RE.test(cardId)) throw new Error(`Not a card id: ${JSON.stringify(cardId)}`);
  // Claude Code assumes a 200k window unless the name ends in `[1m]`; it strips
  // the suffix before the request, so Bifrost still sees `openai/<model>`.
  const main = `openai/${model}${oneMillionContext ? '[1m]' : ''}`;
  const headers = [`x-bf-session-id: ${cardId}`];
  if (noContentLogging) headers.push('x-bf-disable-content-logging: true');
  const env = {
    ANTHROPIC_BASE_URL: `${normaliseUrl(url)}/anthropic`,
    ANTHROPIC_AUTH_TOKEN: DUMMY_TOKEN,
    // --model opus (what the dialog stores) maps through the OPUS slot; a resume
    // passes no --model, so ANTHROPIC_MODEL covers that.
    ANTHROPIC_MODEL: main,
    ANTHROPIC_DEFAULT_OPUS_MODEL: main,
    ANTHROPIC_DEFAULT_SONNET_MODEL: main,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: `openai/${bg}`,
    CLAUDE_CODE_SUBAGENT_MODEL: main,
    ANTHROPIC_CUSTOM_HEADERS: headers.join('\n'),
  };
  if (disableBetas) env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
  return env;
}

// `unset ANTHROPIC_API_KEY; export K='v' …; ` — an export statement rather than
// `env K=v` so it reaches whatever `inner` is. A real ANTHROPIC_API_KEY in the
// server's environment is dropped so it can't ride along to the gateway.
export function buildEnvPrefix(opts) {
  const env = buildEnv(opts);
  const assigns = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`).join(' ');
  return `unset ANTHROPIC_API_KEY; export ${assigns}; `;
}

// The prefix plus `inner`, with our own names removed from a leading
// `env -u NAME …` so the adapter's nested-session scrub can't undo them.
export function wrapInner(inner, prefix) {
  const ours = new Set(VAR_NAMES);
  const m = /^env((?:\s+-u\s+[A-Za-z_][A-Za-z0-9_]*)+)(\s)/.exec(inner);
  if (!m) return prefix + inner;
  const kept = m[1].replace(/\s+-u\s+([A-Za-z_][A-Za-z0-9_]*)/g, (all, name) => (ours.has(name) ? '' : all));
  const head = kept ? `env${kept}${m[2]}` : '';
  return prefix + head + inner.slice(m[0].length);
}
