import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Read-only access to Bifrost's logs.db. Bifrost writes it continuously (WAL),
// so every read opens a short-lived read-only handle and any failure — missing
// file, SQLITE_BUSY, a schema we don't recognise — degrades to `{ ok: false }`.
//
// Only metering columns are selected. The content columns (input_history,
// output_message, responses_*, raw_request, raw_response) are never read.
//
// Attribution: env.js sends `x-bf-session-id: <card id>`, which Bifrost stores
// in logs.session_id. Rows from before that (or from a session the header never
// reached) carry Claude Code's own conversation id there instead, so cost()
// also sums the card's live and prior conversation ids.

// node:sqlite prints one ExperimentalWarning on Node 22, at this import.

export function expandPath(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

const NOT_METERED = `object_type NOT IN ('list_models')`;

function open(file) {
  if (!fs.existsSync(file)) {
    const err = new Error(`logs.db not found at ${file}`);
    err.code = 'ENOENT';
    throw err;
  }
  return new DatabaseSync(file, { readOnly: true, timeout: 250 });
}

function reasonOf(err) {
  if (err?.code === 'ENOENT') return 'missing';
  const msg = String(err?.message || err);
  if (/busy|locked/i.test(msg)) return `locked: ${msg}`;
  return msg;
}

// Per-session totals and per-model totals in one short read.
export function readSummary(file) {
  let db;
  try {
    db = open(file);
    const perSession = new Map();
    for (const r of db.prepare(`SELECT session_id AS sid, SUM(COALESCE(cost, 0)) AS usd, COUNT(*) AS n
        FROM logs WHERE session_id IS NOT NULL AND session_id != '' AND ${NOT_METERED} GROUP BY session_id`).all()) {
      perSession.set(r.sid, { usd: r.usd, requests: r.n });
    }
    const totalsByModel = db.prepare(`SELECT provider, model, COUNT(*) AS requests,
        SUM(prompt_tokens) AS prompt, SUM(cached_read_tokens) AS cached, SUM(completion_tokens) AS completion,
        SUM(COALESCE(cost, 0)) AS usd
        FROM logs WHERE ${NOT_METERED} GROUP BY provider, model ORDER BY usd DESC`).all()
      .map((r) => ({ ...r }));
    return { ok: true, perSession, totalsByModel };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

export function readRecent(file, limit = 200) {
  let db;
  try {
    db = open(file);
    const rows = db.prepare(`SELECT id, timestamp, provider, model, session_id AS sessionId,
        prompt_tokens AS prompt, cached_read_tokens AS cached, completion_tokens AS completion,
        cost, status, error_details AS error
        FROM logs WHERE ${NOT_METERED} ORDER BY timestamp DESC LIMIT ?`).all(Math.max(1, Math.min(1000, limit)))
      .map((r) => ({ ...r, error: r.error ? String(r.error).slice(0, 2000) : '' }));
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

// readSummary memoised per path for `ttlMs`, so cost() for N cards on one tick
// is one query.
export function createLogsReader({ ttlMs = 3000, now = Date.now, read = readSummary } = {}) {
  let cache = { file: null, at: 0, value: null };
  return {
    summary(file) {
      if (!file) return { ok: false, reason: 'logs.db path not set' };
      const t = now();
      if (cache.file === file && t - cache.at < ttlMs) return cache.value;
      const value = read(file);
      cache = { file, at: t, value };
      return value;
    },
  };
}

// The ids a card's requests can be logged under: its own (the header) and
// every conversation id it has had (rows without the header).
export function idsForEntry(entry) {
  const ids = [entry?.sessionId, entry?.liveSessionId, ...(Array.isArray(entry?.priorLiveSessionIds) ? entry.priorLiveSessionIds : [])];
  return [...new Set(ids.filter((x) => typeof x === 'string' && x))];
}

// { usd } from Bifrost's log, or null when nothing in it belongs to the card.
export function costForEntry(summary, entry) {
  if (!summary?.ok) return null;
  let usd = 0;
  let found = false;
  for (const id of idsForEntry(entry)) {
    const hit = summary.perSession.get(id);
    if (hit) { usd += hit.usd || 0; found = true; }
  }
  return found ? { usd } : null;
}
