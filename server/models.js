// Pure: turn Bifrost's /anthropic/v1/models answer into the dispatch dialog's
// list, and remember the last good one for when the gateway is down.

// Chat-capable gpt-* only; Bifrost lists every model the key can see.
const NOT_CHAT = /(audio|realtime|transcribe|tts|search|image|instruct|embedding)/;

export function chatModelIds(body) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const ids = new Set();
  for (const row of rows) {
    const raw = typeof row === 'string' ? row : row?.id;
    if (typeof raw !== 'string') continue;
    const id = raw.startsWith('openai/') ? raw.slice('openai/'.length) : raw;
    if (!/^gpt-[A-Za-z0-9._:-]+$/.test(id) || NOT_CHAT.test(id)) continue;
    ids.add(id);
  }
  return [...ids].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
}

export function createModelCache() {
  let last = [];
  return {
    // A fetch result -> what the client is told.
    note(result) {
      if (result.ok) {
        last = chatModelIds(result.body);
        return { models: last, stale: false, reachable: true };
      }
      return { models: last, stale: true, reachable: false, error: result.error };
    },
    get last() { return last; },
  };
}
