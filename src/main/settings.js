// Настройки приложения: хранятся в JSON в папке данных, API-ключ лежит только в зашифрованном виде.
// Шифрование передаётся снаружи (safeStorage), поэтому логику можно тестировать без Electron.
const path = require('path');
const { writeJsonAtomic, readJsonSafe } = require('../shared/fsutil');

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

const BUDDY_SIZES = ['small', 'medium', 'large'];

const DEFAULTS = {
  buddySize: 'medium',
  driftSec: 20,
  model: 'claude-opus-5-5',
  vision: false,
  visionIntervalSec: 45,
  startMentorOnOpen: true,
  autoStart: false,
  distractSites: [],
  focusSites: [],
  driftLines: [],
  backLines: [],
};

const LIST_LIMITS = {
  distractSites: { items: 50, chars: 80 },
  focusSites: { items: 50, chars: 80 },
  driftLines: { items: 20, chars: 160 },
  backLines: { items: 20, chars: 160 },
};

function clampInt(value, lo, hi, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function cleanList(value, { items, chars }) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const text = String(entry).trim().slice(0, chars);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= items) break;
  }
  return out;
}

// Приводит любые входные данные к допустимым настройкам.
function normalize(input = {}, base = DEFAULTS) {
  const s = { ...base, ...input };
  const out = {
    buddySize: BUDDY_SIZES.includes(s.buddySize) ? s.buddySize : base.buddySize,
    driftSec: clampInt(s.driftSec, 5, 300, base.driftSec),
    model: MODELS.includes(s.model) ? s.model : base.model,
    vision: Boolean(s.vision),
    visionIntervalSec: clampInt(s.visionIntervalSec, 15, 600, base.visionIntervalSec),
    startMentorOnOpen: Boolean(s.startMentorOnOpen),
    autoStart: Boolean(s.autoStart),
  };
  for (const [key, limits] of Object.entries(LIST_LIMITS)) out[key] = cleanList(s[key], limits);
  return out;
}

class SettingsStore {
  // crypto: { encrypt(text) -> base64, decrypt(base64) -> text } или null, если шифрование недоступно.
  constructor(dir, crypto = null, envDefaults = {}) {
    this.file = path.join(dir, 'nazar-settings.json');
    this.crypto = crypto;
    this.base = normalize(envDefaults, DEFAULTS);
    this.apiKeyEnc = '';
    // Первый запуск или повреждённый файл: работаем со значениями по умолчанию.
    const saved = readJsonSafe(this.file) || {};
    this.apiKeyEnc = typeof saved.apiKeyEnc === 'string' ? saved.apiKeyEnc : '';
    this.data = normalize(saved, this.base);
  }

  _save() {
    writeJsonAtomic(this.file, { ...this.data, apiKeyEnc: this.apiKeyEnc });
  }

  // patch.apiKey: новый ключ (пустая строка значит «не менять»); patch.clearKey: удалить ключ.
  update(patch = {}) {
    const { apiKey, clearKey, ...rest } = patch;
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (key && !this.crypto) throw new Error('Шифрование недоступно, ключ не сохранён');
    this.data = normalize({ ...this.data, ...rest }, this.base);
    if (clearKey) this.apiKeyEnc = '';
    if (key) this.apiKeyEnc = this.crypto.encrypt(key);
    this._save();
    return this.view();
  }

  reset() {
    this.data = { ...this.base };
    this._save();
    return this.view();
  }

  apiKey() {
    if (!this.apiKeyEnc || !this.crypto) return '';
    try {
      return this.crypto.decrypt(this.apiKeyEnc);
    } catch {
      return '';
    }
  }

  // То, что можно показать в окне: без самого ключа.
  view() {
    return { ...this.data, hasKey: Boolean(this.apiKeyEnc) };
  }
}

module.exports = { SettingsStore, normalize, DEFAULTS, MODELS, BUDDY_SIZES };
