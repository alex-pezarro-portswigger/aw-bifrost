import { fileURLToPath } from 'node:url';
import { CardStore } from './card-store.js';
import {
  DEFAULT_URL, DEFAULT_BACKGROUND_MODEL, buildEnvPrefix, wrapInner, isOpenAiModel, normaliseUrl,
} from './env.js';
import { ping, listModels, createGatewayStatus } from './gateway.js';
import { createModelCache } from './models.js';
import { createLogsReader, readRecent, costForEntry, expandPath } from './logs.js';

// The repo root: `client`/`styles` resolve inside <dir>/public/.
export const dir = fileURLToPath(new URL('..', import.meta.url));

export const RUNTIME_ID = 'bifrost';

// Setting values as the code uses them. Defs carry no defaults, so an unset
// value reads undefined and falls back here.
export function resolveSettings(s = {}) {
  return {
    url: (() => { try { return normaliseUrl(s.url || DEFAULT_URL); } catch { return String(s.url); } })(),
    logsDb: s.logsDb ? expandPath(String(s.logsDb).trim()) : null,
    backgroundModel: (s.backgroundModel && String(s.backgroundModel).trim()) || DEFAULT_BACKGROUND_MODEL,
    disableBetas: s.allowBetas !== true,
    noContentLogging: s.noContentLogging === true,
    oneMillionContext: s.disable1mContext !== true,
  };
}

// Built per manifest so tests get their own caches.
export function createBifrost({ fetchImpl, now } = {}) {
  const opts = fetchImpl ? { fetchImpl } : {};
  const gateway = createGatewayStatus({ list: (url) => ping(url, opts), ...(now ? { now } : {}) });
  const models = createModelCache();
  const logs = createLogsReader(now ? { now } : {});

  async function preflight({ agent, ext, settings }) {
    const cfg = resolveSettings(settings);
    if (agent && agent !== 'claude') return 'Bifrost runtime supports Claude Code sessions only';
    if (!isOpenAiModel(ext?.model)) return 'Pick an OpenAI model';
    const res = await gateway.refresh(cfg.url);
    if (!res.ok) return `Bifrost isn't reachable at ${cfg.url}; start it with scripts/run-bifrost.sh`;
    return null;
  }

  // The card id is the record key; a fork's first launch reads its parent's
  // (onFork copies it right after).
  async function wrapLaunch({ inner, sessionId, parentId, settings, host }) {
    const store = host.stores.cards;
    const rec = store.get(sessionId) || (parentId ? store.get(parentId) : undefined);
    if (!rec?.model) throw new Error('No Bifrost model recorded for this session');
    const cfg = resolveSettings(settings);
    const prefix = buildEnvPrefix({
      url: cfg.url, model: rec.model, backgroundModel: cfg.backgroundModel, cardId: sessionId,
      disableBetas: cfg.disableBetas, noContentLogging: cfg.noContentLogging, oneMillionContext: cfg.oneMillionContext,
    });
    return wrapInner(inner, prefix);
  }

  async function cost({ entry, settings }) {
    const cfg = resolveSettings(settings);
    if (!cfg.logsDb) return null;
    return costForEntry(logs.summary(cfg.logsDb), entry);
  }

  // Graph tick: cached reads only, never throws.
  function graph({ host }) {
    try {
      const cfg = resolveSettings(host.settings.all());
      gateway.poke(cfg.url);
      const status = gateway.peek(cfg.url);
      const summary = cfg.logsDb ? logs.summary(cfg.logsDb) : { ok: false, reason: 'logs.db path not set' };
      return {
        bifrost: {
          url: cfg.url,
          reachable: status ? status.ok : null,
          gatewayError: status && !status.ok ? status.error : null,
          logs: summary.ok ? { ok: true } : { ok: false, reason: summary.reason },
          totalsByModel: summary.ok ? summary.totalsByModel : [],
        },
      };
    } catch (err) {
      return { bifrost: { reachable: null, logs: { ok: false, reason: String(err?.message || err) }, totalsByModel: [] } };
    }
  }

  // Handlers answer by broadcast (`ext:bifrost`), the browser half's only inbound channel.
  async function modelsHandler(msg, host) {
    const cfg = resolveSettings(host.settings.all());
    const answer = models.note(await listModels(cfg.url, opts));
    host.broadcast({ kind: 'models', ...answer });
  }

  async function recentHandler(msg, host) {
    const cfg = resolveSettings(host.settings.all());
    const limit = Number.isInteger(msg?.limit) ? msg.limit : 200;
    const res = cfg.logsDb ? readRecent(cfg.logsDb, limit) : { ok: false, reason: 'logs.db path not set' };
    host.broadcast({ kind: 'recent', ...res });
  }

  return { preflight, wrapLaunch, cost, graph, modelsHandler, recentHandler };
}

const bifrost = createBifrost();

export const session = {
  // Fires before wrapLaunch. `ext` is only sent by the dialog while the Bifrost
  // runtime is selected.
  onBeforeDispatch({ sessionId, ext, host }) {
    if (isOpenAiModel(ext?.model)) host.stores.cards.set(sessionId, { model: ext.model });
  },
  // After the fork's first launch (which read the parent): later resumes of the
  // fork find their own record.
  onFork({ sessionId, parentId, host }) {
    if (parentId) host.stores.cards.copy(parentId, sessionId);
  },
  onPurge({ sessionId, host }) {
    host.stores.cards.delete(sessionId);
  },
};

export default {
  id: 'bifrost',
  label: 'Bifrost (OpenAI)',
  description: 'Adds a Bifrost runtime: Claude Code sessions that talk to OpenAI models through a Bifrost gateway you run yourself, with Bifrost\'s own cost on the card and a view of its request log.',
  help: 'Connect-only: start Bifrost yourself (scripts/run-bifrost.sh). Only sessions dispatched with Runtime = Bifrost are routed through it; every other session is untouched.',
  author: 'Alex Pezarro',
  homepage: 'https://github.com/alex-pezarro-portswigger/aw-bifrost',
  defaultEnabled: true,
  dir,
  requires: ['board:broadcast'],
  // 1.29.0: the runtime `cost` hook and `parentId` on fork wrapLaunch.
  engines: { wranglerApi: '^1.29.0' },
  hideDispatchField: ['model'],

  settings: [
    { key: 'url', type: 'text', label: 'Bifrost URL', placeholder: DEFAULT_URL, pattern: 'https?://.+', maxLength: 200,
      help: 'Where your Bifrost gateway listens. Empty uses http://127.0.0.1:8080.' },
    { key: 'logsDb', type: 'text', label: 'Bifrost logs.db', placeholder: '~/Projects/bifrost/app/logs.db', maxLength: 500,
      help: 'Path to Bifrost\'s logs.db (in its app dir). Needed for card cost and the Bifrost view; read-only.' },
    { key: 'backgroundModel', type: 'text', label: 'Background model', placeholder: DEFAULT_BACKGROUND_MODEL, pattern: '[A-Za-z0-9._:-]+', maxLength: 100,
      help: 'The OpenAI model Claude Code uses for its small background calls (the haiku slot).' },
    { key: 'allowBetas', type: 'toggle', label: 'Allow experimental betas',
      help: 'Off sets CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1, because Anthropic-only beta headers can break OpenAI requests.' },
    { key: 'disable1mContext', type: 'toggle', label: 'Disable 1M context',
      help: 'Off tags the main model with [1m] so Claude Code treats its context window as 1M tokens instead of 200k. Turn on for models that do not support 1M.' },
    { key: 'noContentLogging', type: 'toggle', label: 'Ask Bifrost not to log content',
      help: 'Sends x-bf-disable-content-logging: true. Bifrost v2.2.6 ignored it in testing; set client.disable_content_logging in Bifrost\'s config to be sure.' },
  ],

  stores: { cards: ({ log }) => new CardStore({ log }) },

  handlers: [
    { type: 'bifrost-models', handler: bifrost.modelsHandler },
    { type: 'bifrost-recent', handler: bifrost.recentHandler },
  ],

  graph: bifrost.graph,
  session,

  runtimes: [{
    id: RUNTIME_ID,
    label: 'Bifrost (OpenAI)',
    preflight: bifrost.preflight,
    wrapLaunch: bifrost.wrapLaunch,
    cost: bifrost.cost,
  }],

  client: 'public/client.js',
  styles: 'public/bifrost.css',
};
