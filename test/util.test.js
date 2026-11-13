const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clamp, plural, minutes, minutesAcc, points, times, fmtMin, fmtClock, hexToRgb, fill } = require('../src/shared/util');
const { trayMenuTemplate } = require('../src/main/tray-menu');
const { LockFile } = require('../src/main/lock-file');
const { Session } = require('../src/main/session');

test('clamp: границы, округление и мусор на входе', () => {
  assert.strictEqual(clamp(7.6, 1, 10), 8);
  assert.strictEqual(clamp(99, 1, 10), 10);
  assert.strictEqual(clamp('abc', 5, 60), 5);
  assert.strictEqual(clamp('abc', 5, 60, 20), 20);
});

test('склонения по-русски', () => {
  assert.strictEqual(plural(21, 'минута', 'минуты', 'минут'), 'минута');
  assert.strictEqual(minutes(1), '1 минута');
  assert.strictEqual(minutesAcc(1), '1 минуту');
  assert.strictEqual(minutes(3), '3 минуты');
  assert.strictEqual(minutes(12), '12 минут');
  assert.strictEqual(times(4), '4 раза');
  assert.strictEqual(points(333), '333 балла');
  assert.strictEqual(points(500), '500 баллов');
  assert.strictEqual(points(21), '21 балл');
  assert.strictEqual(times(11), '11 раз');
});

test('форматы времени, цвет и шаблоны', () => {
  assert.strictEqual(fmtMin(40), '40 сек');
  assert.strictEqual(fmtMin(600), '10 мин');
  assert.strictEqual(fmtClock(125), '02:05');
  assert.deepStrictEqual(hexToRgb('#ffd166'), [255, 209, 102]);
  assert.strictEqual(fill('Цель «{goal}», нет {x}', { goal: 'код' }), 'Цель «код», нет ');
});

test('меню трея при блокировке: нельзя начать новую сессию, есть «Сдаться»', () => {
  const noop = () => {};
  const act = new Proxy({}, { get: () => noop });
  const locked = trayMenuTemplate({ mentorOn: true, locked: true, goal: 'Курсовая', vision: false, ai: false }, act);
  const labels = locked.map((i) => i.label).filter(Boolean);
  assert.ok(labels.some((l) => l.startsWith('🔒 Выключить')));
  assert.ok(labels.includes('🏳 Сдаться досрочно…'));
  assert.strictEqual(locked.find((i) => i.label === 'Новая сессия…').enabled, false);
  const free = trayMenuTemplate({ mentorOn: true, locked: false, goal: null, vision: false, ai: false }, act);
  assert.ok(!free.some((i) => i.label === '🏳 Сдаться досрочно…'));
});

test('снимок блокировки: сохраняется только для строгой сессии и удаляется сразу', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nazar-lock-'));
  const lf = new LockFile(path.join(dir, 'active.json'));
  lf.save(new Session({ goal: 'g', minutes: 25, now: 0 }), true);
  assert.strictEqual(lf.load(), null, 'обычную сессию не храним');
  const strict = new Session({ goal: 'g', minutes: 45, strict: true, now: 0 });
  lf.save(strict, true);
  assert.strictEqual(lf.load().goal, 'g');
  lf.clear();
  assert.strictEqual(lf.load(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

const { betOptions } = require('../src/shared/util');

test('ставки считаются от баланса: при 500 баллах 50/125/250/500', () => {
  assert.deepStrictEqual(
    betOptions(500).map((o) => o.label),
    ['10% · 50', '25% · 125', '50% · 250', 'Ва-банк · 500']
  );
  assert.strictEqual(betOptions(500).at(-1).allIn, true);
});

test('маленький баланс: без повторов, ва-банк всегда есть, при нуле ставок нет', () => {
  assert.deepStrictEqual(
    betOptions(6).map((o) => o.amount),
    [1, 2, 3, 6]
  );
  assert.deepStrictEqual(
    betOptions(2).map((o) => o.label),
    ['10% · 1', 'Ва-банк · 2']
  );
  assert.deepStrictEqual(
    betOptions(1).map((o) => o.label),
    ['Ва-банк · 1']
  );
  assert.deepStrictEqual(betOptions(0), []);
  assert.deepStrictEqual(betOptions('мусор'), []);
});
