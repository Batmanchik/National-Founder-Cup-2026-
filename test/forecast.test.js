const test = require('node:test');
const assert = require('node:assert');
const { Session } = require('../src/main/session');
const { forecastOf } = require('../src/main/store');
const { offlineChat } = require('../src/main/mentor');

const F = { category: 'focus', label: 'Код' };
const TG = { category: 'neutral', label: 'Мессенджеры' };
const INSTA = { category: 'distraction', label: 'Instagram', confident: true };
const MIN = 60_000;

test('срыв записывается: через сколько минут работы, откуда и куда', () => {
  const s = new Session({ goal: 'код', minutes: 60, now: 0 });
  s.record(F, 10 * 60, 10 * MIN);
  s.record(TG, 60, 11 * MIN);
  for (let t = 1; t <= 3; t++) s.record(INSTA, 1, 11 * MIN + t * 1000);
  assert.deepStrictEqual(s.summary(12 * MIN).slips, [{ afterMin: 11, before: 'Мессенджеры', beforeCat: 'neutral', to: 'Instagram' }]);
});

test('короткое заглядывание в ленту без напоминания — не срыв', () => {
  const s = new Session({ goal: 'код', minutes: 60, now: 0 });
  s.record(F, 60, MIN);
  s.record(INSTA, 1, MIN + 1000);
  s.record(F, 60, 2 * MIN);
  assert.deepStrictEqual(s.slips, []);
});

test('прогноз: медиана минуты срыва, цель и «крючок» из нейтральных окон', () => {
  const slip = (afterMin, before, beforeCat, to = 'Instagram') => ({ afterMin, before, beforeCat, to });
  assert.strictEqual(forecastOf([{ slips: [slip(10, 'Мессенджеры', 'neutral')] }]), null, 'меньше 3 срывов — прогноза нет');
  const f = forecastOf([
    { slips: [slip(16, 'Мессенджеры', 'neutral'), slip(18, 'Мессенджеры', 'neutral')] },
    { slips: [slip(17, 'Код', 'focus', 'Короткие видео')] },
  ]);
  assert.deepStrictEqual(f, { typicalMin: 17, trigger: 'Мессенджеры', target: 'Instagram', slips: 3 });
  const work = forecastOf([{ slips: [slip(5, 'Код', 'focus'), slip(6, 'Код', 'focus'), slip(7, 'Код', 'focus')] }]);
  assert.strictEqual(work.trigger, null, 'рабочее приложение не может быть «крючком»');
});

test('Акыл предупреждает за минуту до типичного срыва — один раз за полосу работы', () => {
  const s = new Session({ goal: 'код', minutes: 60, forecast: { typicalMin: 17, trigger: null, target: 'Instagram' }, now: 0 });
  const ev = [];
  for (let m = 1; m <= 20; m++) ev.push(...s.record(F, 60, m * MIN));
  assert.deepStrictEqual(
    ev.filter((e) => e === 'slip-ahead'),
    ['slip-ahead']
  );
  const first = [];
  const s2 = new Session({ goal: 'код', minutes: 60, forecast: { typicalMin: 17, trigger: null, target: 'Instagram' }, now: 0 });
  for (let m = 1; m <= 16; m++) first.push(...s2.record(F, 60, m * MIN));
  assert.strictEqual(first.lastIndexOf('slip-ahead'), first.length - 1, 'сработало на 16-й минуте');
});

test('после возврата из ленты отсчёт до срыва начинается заново', () => {
  const s = new Session({ goal: 'код', minutes: 120, forecast: { typicalMin: 5, trigger: null, target: 'Instagram' }, now: 0 });
  let t = 0;
  const ev = [];
  for (let m = 1; m <= 5; m++) ev.push(...s.record(F, 60, (t += MIN)));
  for (let k = 1; k <= 3; k++) ev.push(...s.record(INSTA, 1, (t += 1000)));
  for (let m = 1; m <= 5; m++) ev.push(...s.record(F, 60, (t += MIN)));
  assert.deepStrictEqual(ev.filter((e) => e === 'slip-ahead').length, 2);
});

test('открыл окно-«крючок» — Акыл предупреждает до ухода в ленту', () => {
  const s = new Session({ goal: 'код', minutes: 60, forecast: { typicalMin: 30, trigger: 'Мессенджеры', target: 'Instagram' }, now: 0 });
  assert.deepStrictEqual(s.record(F, 60, MIN), []);
  assert.deepStrictEqual(s.record(TG, 1, MIN + 1000), ['slip-trigger']);
  assert.deepStrictEqual(s.record(TG, 1, MIN + 2000), [], 'не спамит');
});

test('чат: «когда я срываюсь?»', () => {
  const none = offlineChat('когда я срываюсь?', { goal: 'g', memory: null });
  assert.match(none.reply, /мало данных/);
  const r = offlineChat('когда я срываюсь?', {
    goal: 'g',
    memory: { forecast: { typicalMin: 17, trigger: 'Мессенджеры', target: 'Instagram' } },
  });
  assert.match(r.reply, /17-й минуте.*Instagram.*Мессенджеры/);
});
