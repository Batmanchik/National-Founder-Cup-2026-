const test = require('node:test');
const assert = require('node:assert');
const { adValue, weeklyAdValue, rateFor, USD_TO_KZT } = require('../src/main/attention-value');
const { Session } = require('../src/main/session');
const { memoryOf } = require('../src/main/store');
const { offlineChat } = require('../src/main/mentor');
const { fmtTenge } = require('../src/shared/util');

test('час Instagram стоит дороже часа YouTube, сериалы и игры не считаются', () => {
  assert.ok(rateFor('Instagram') > rateFor('YouTube'));
  assert.strictEqual(rateFor('Сериалы'), 0);
  assert.strictEqual(rateFor('Игры'), 0);
  assert.strictEqual(rateFor('kaspi магазин'), 0, 'свои слова пользователя — не рекламная лента');
});

test('счёт за внимание: час Instagram по среднемировой ставке', () => {
  const v = adValue({ Instagram: 3600, Игры: 3600 });
  assert.strictEqual(Math.round(v.tenge * 10) / 10, Math.round(0.13 * USD_TO_KZT * 10) / 10);
  assert.strictEqual(v.countedSec, 3600);
  assert.strictEqual(v.top.label, 'Instagram');
  assert.strictEqual(adValue({}).tenge, 0);
  assert.strictEqual(adValue(undefined).tenge, 0);
});

test('принимает и объект, и список «воров» из истории', () => {
  assert.strictEqual(adValue([{ label: 'Короткие видео', sec: 1800 }]).tenge, adValue({ 'Короткие видео': 1800 }).tenge);
});

test('сессия кладёт счёт в чек', () => {
  const s = new Session({ goal: 'код', minutes: 60, now: 0 });
  s.record({ category: 'distraction', label: 'Instagram' }, 600, 600_000);
  assert.strictEqual(s.summary(600_000).adValue, 9.8);
  assert.ok(s.live(600_000).adValue > 9.7);
});

test('неделя и прогноз на год; старые сессии без поля считаются по «ворам»', () => {
  const now = 30 * 86400000;
  const sessions = [
    { endedAt: now - 86400000, adValue: 20 },
    { endedAt: now - 2 * 86400000, topDistractors: [{ label: 'Instagram', sec: 3600 }] },
    { endedAt: now - 20 * 86400000, adValue: 999 },
  ];
  const { week, year } = weeklyAdValue(sessions, now);
  assert.strictEqual(Math.round(week * 10) / 10, 78.5);
  assert.strictEqual(Math.round(year), Math.round(78.5 * 52));
  assert.strictEqual(Math.round(memoryOf(sessions, now).weekAdValue * 10) / 10, 78.5);
});

test('формат тенге', () => {
  assert.strictEqual(fmtTenge(4.56), '≈ 4,6 ₸');
  assert.strictEqual(fmtTenge(140.4), '≈ 140 ₸');
  assert.strictEqual(fmtTenge(7300), '≈ 7 300 ₸');
  assert.strictEqual(fmtTenge(0), '0 ₸');
});

test('Акыл отвечает на «сколько на мне заработали»', () => {
  const r = offlineChat('сколько на мне заработали?', { goal: 'g', live: { adValue: 12 }, memory: { weekAdValue: 100, topThieves: [] } });
  assert.match(r.reply, /≈ 12 ₸/);
  assert.match(r.reply, /за год в таком темпе ≈ 5 200 ₸/);
});
