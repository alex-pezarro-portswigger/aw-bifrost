import { normaliseUrl } from './env.js';

// The only network calls the extension makes, both to the configured gateway.
// No auth header is sent (Bifrost runs with inference auth off) and nothing
// about a request is logged.

export const TIMEOUT_MS = 2000;

export async function listModels(url, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  let base;
  try { base = normaliseUrl(url); } catch (err) { return { ok: false, error: err.message }; }
  try {
    const res = await fetchImpl(`${base}/anthropic/v1/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, body: await res.json() };
  } catch (err) {
    return { ok: false, error: err?.name === 'TimeoutError' ? 'timed out' : (err?.cause?.code || err?.message || 'unreachable') };
  }
}

// Reachability plus the model list, refreshed at most every `ttlMs`, for the
// ~4s graph tick to read without waiting on the network.
export function createGatewayStatus({ ttlMs = 15000, list = listModels, now = Date.now } = {}) {
  let state = { url: null, at: 0, result: null };
  let inflight = null;
  return {
    peek(url) {
      return state.url === url ? state.result : null;
    },
    // Fire-and-forget refresh when stale; never throws.
    poke(url) {
      if (inflight || (state.url === url && now() - state.at < ttlMs)) return;
      inflight = list(url).then((result) => { state = { url, at: now(), result }; })
        .catch(() => {}).finally(() => { inflight = null; });
    },
    async refresh(url) {
      const result = await list(url);
      state = { url, at: now(), result };
      return result;
    },
  };
}
