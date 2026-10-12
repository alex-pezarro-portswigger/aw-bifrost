import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './data-dir.js';
import { isOpenAiModel } from './env.js';

// `{ [cardId]: { model } }`: which OpenAI model each Bifrost card runs on, so a
// resume or fork relaunches on the same one. One JSON file, written temp +
// rename so a crash never leaves it torn.
export class CardStore {
  constructor({ file = path.join(DATA_DIR, 'bifrost', 'cards.json'), log = () => {} } = {}) {
    this.file = file;
    this.log = log;
    this.map = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      if (err.code !== 'ENOENT') this.log(`cards.json unreadable, starting empty: ${err.message}`);
      return {};
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.map, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get(id) {
    return Object.hasOwn(this.map, id) ? { ...this.map[id] } : undefined;
  }

  set(id, { model }) {
    if (!isOpenAiModel(model)) throw new Error(`Not an OpenAI model id: ${JSON.stringify(model)}`);
    this.map[id] = { model };
    this._save();
  }

  copy(from, to) {
    const rec = this.get(from);
    if (rec === undefined) return false;
    this.set(to, rec);
    return true;
  }

  delete(id) {
    if (!Object.hasOwn(this.map, id)) return false;
    delete this.map[id];
    this._save();
    return true;
  }
}
