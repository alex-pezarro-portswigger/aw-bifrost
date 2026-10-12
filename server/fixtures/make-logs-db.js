import { DatabaseSync } from 'node:sqlite';

// A logs.db with Bifrost v2.2.6's `logs` table, trimmed to the columns the
// extension reads plus a few content columns it must never read.
const DDL = `CREATE TABLE logs (
  id varchar(255) PRIMARY KEY, timestamp datetime NOT NULL, object_type varchar(255) NOT NULL,
  provider varchar(255) NOT NULL, model varchar(255) NOT NULL, session_id varchar(255), metadata text,
  input_history text, output_message text, raw_request text, raw_response text,
  cost real, status varchar(50) NOT NULL, error_details text,
  prompt_tokens integer DEFAULT 0, completion_tokens integer DEFAULT 0, cached_read_tokens integer DEFAULT 0,
  created_at datetime NOT NULL)`;

let seq = 0;
export function makeLogsDb(file, rows = []) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(DDL);
  const ins = db.prepare(`INSERT INTO logs (id, timestamp, object_type, provider, model, session_id, input_history,
    cost, status, error_details, prompt_tokens, completion_tokens, cached_read_tokens, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'SECRET PROMPT', ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rows) {
    const ts = r.timestamp || `2026-10-12 12:00:${String(seq % 60).padStart(2, '0')}.000000+00:00`;
    ins.run(r.id || `row-${++seq}`, ts, r.objectType || 'responses', r.provider || 'openai', r.model || 'gpt-5.5',
      r.sessionId ?? null, r.cost ?? null, r.status || 'success', r.error || '', r.prompt || 0, r.completion || 0, r.cached || 0, ts);
  }
  db.close();
  return file;
}
