import os from 'node:os';
import path from 'node:path';

// The wrangler's state dir, resolved the way agent-wrangler does it
// (AW_DATA_DIR, else ~/.agent-wrangler), so a run-dev instance stays isolated.
function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export const DATA_DIR = process.env.AW_DATA_DIR
  ? path.resolve(expandTilde(process.env.AW_DATA_DIR))
  : path.join(os.homedir(), '.agent-wrangler');
