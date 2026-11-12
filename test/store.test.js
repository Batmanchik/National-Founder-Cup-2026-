const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, streakDays } = require('../src/main/store');

const day = (y, m, d, h = 12) => new Date(y, m, d, h).getTime();

test('серия не обнуляется утром, пока сегодня ещё нет сессии', () => {
  const sessions = [{ endedAt: day(2026, 10, 10) }, { endedAt: day(2026, 10, 11) }];
  assert.strictEqual(streakDays(sessions, day(2026, 10, 12, 8)), 2);
  assert.strictEqual(streakDays([...sessions, { endedAt: day(2026, 10, 12, 7) }], day(2026, 10, 12, 8)), 3);
});

test('пропущенный день обрывает серию', () => {
  assert.strictEqual(streakDays([{ endedAt: day(2026, 10, 9) }], day(2026, 10, 12)), 0);
  assert.strictEqual(streakDays([], day(2026, 10, 12)), 0);
});

test('повреждённый файл не затирается молча', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nazar-'));
  const file = path.join(dir, 'nazar-data.json');
  fs.writeFileSync(file, '{ сломано');
  const store = new Store(dir);
  assert.strictEqual(store.data.xp, 0);
  assert.ok(fs.existsSync(`${file}.broken`));
  store.addSession({ xpEarned: 5, endedAt: Date.now(), goal: 'g', focusScore: 90 });
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).xp, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});
