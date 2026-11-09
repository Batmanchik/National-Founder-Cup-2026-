const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SettingsStore, normalize, DEFAULTS } = require('../src/main/settings');
const { classify } = require('../src/main/classifier');
const { Session } = require('../src/main/session');

const fakeCrypto = {
  encrypt: (t) => Buffer.from(`x:${t}`).toString('base64'),
  decrypt: (b) => Buffer.from(b, 'base64').toString().slice(2),
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nazar-'));

test('значения приводятся к допустимым пределам', () => {
  const s = normalize({ driftSec: 1, visionIntervalSec: 9999, model: 'нет такой', distractSites: ' a.com\n\nA.com\nb.com ' });
  assert.strictEqual(s.driftSec, 5);
  assert.strictEqual(s.visionIntervalSec, 600);
  assert.strictEqual(s.model, DEFAULTS.model);
  assert.deepStrictEqual(s.distractSites, ['a.com', 'b.com']);
});

test('настройки сохраняются между запусками, ключ не лежит открытым текстом и не попадает в окно', () => {
  const dir = tmp();
  const a = new SettingsStore(dir, fakeCrypto);
  const view = a.update({ driftSec: 7, apiKey: ' sk-test ' });
  assert.strictEqual(view.hasKey, true);
  assert.strictEqual('apiKey' in view || 'apiKeyEnc' in view, false);
  assert.ok(!fs.readFileSync(a.file, 'utf8').includes('sk-test'));
  const b = new SettingsStore(dir, fakeCrypto);
  assert.strictEqual(b.data.driftSec, 7);
  assert.strictEqual(b.apiKey(), 'sk-test');
});

test('пустой ключ не стирает сохранённый, clearKey удаляет', () => {
  const s = new SettingsStore(tmp(), fakeCrypto);
  s.update({ apiKey: 'k1' });
  s.update({ apiKey: '', driftSec: 9 });
  assert.strictEqual(s.apiKey(), 'k1');
  s.update({ clearKey: true });
  assert.strictEqual(s.apiKey(), '');
});

test('без шифрования ключ отклоняется и настройки не меняются', () => {
  const s = new SettingsStore(tmp(), null);
  assert.throws(() => s.update({ apiKey: 'k', driftSec: 9 }));
  assert.strictEqual(s.data.driftSec, DEFAULTS.driftSec);
});

test('сброс возвращает значения, но сохраняет ключ', () => {
  const s = new SettingsStore(tmp(), fakeCrypto);
  s.update({ driftSec: 99, apiKey: 'k1' });
  s.reset();
  assert.strictEqual(s.data.driftSec, DEFAULTS.driftSec);
  assert.strictEqual(s.apiKey(), 'k1');
});

test('свои сайты важнее встроенных правил', () => {
  const win = { app: 'chrome', title: 'Reels • Instagram', url: '' };
  assert.strictEqual(classify(win, 'курсовая').category, 'distraction');
  assert.strictEqual(classify(win, 'курсовая', { focus: ['instagram'] }).category, 'focus');
  const wiki = { app: 'chrome', title: 'Википедия', url: '' };
  assert.strictEqual(classify(wiki, 'курсовая', { distract: ['википедия'] }).category, 'distraction');
});

test('порог напоминания задаётся настройкой и меняется на ходу', () => {
  const D = { category: 'distraction', label: 'X' };
  const s = new Session({ goal: 'код', minutes: 25, driftSec: 4, now: 0 });
  assert.deepStrictEqual(s.record(D, 2, 2000), []);
  assert.deepStrictEqual(s.record(D, 2, 4000), ['drift']);
  const t = new Session({ goal: 'код', minutes: 25, driftSec: 100, now: 0 });
  t.setDriftSec(2);
  assert.deepStrictEqual(t.record(D, 2, 2000), ['drift']);
});
