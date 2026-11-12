const test = require('node:test');
const assert = require('node:assert');
const { Session, DRIFT_NUDGE_SEC } = require('../src/main/session');

const D = { category: 'distraction', label: 'Instagram' };
const F = { category: 'focus', label: 'Код' };

test('напоминание после порога отвлечения и возврат к цели', () => {
  const t0 = 1_000_000;
  const s = new Session({ goal: 'код', minutes: 25, now: t0 });
  const events = [];
  let t = t0;
  for (let i = 0; i < DRIFT_NUDGE_SEC / 2; i++) events.push(...s.record(D, 2, (t += 2000)));
  assert.deepStrictEqual(events, ['drift']);
  assert.deepStrictEqual(s.record(F, 2, (t += 2000)), ['back']);
  assert.strictEqual(s.returns, 1);
  assert.strictEqual(s.nudges, 1);
});

test('перерыв не считается отвлечением и заканчивается событием', () => {
  const s = new Session({ goal: 'код', minutes: 60, now: 0 });
  s.record(F, 25 * 60, 25 * 60_000); // заработал 5 мин
  const t0 = 25 * 60_000;
  assert.strictEqual(s.grantBreak(5, t0).minutes, 5);
  s.record(D, 2, t0 + 60_000);
  assert.strictEqual(s.totals.break, 2);
  assert.strictEqual(s.totals.distraction, 0);
  assert.deepStrictEqual(s.record(F, 2, t0 + 5 * 60_000 + 1), ['break-over']);
});

test('фокус-процент, таймлайн и окончание времени', () => {
  const s = new Session({ goal: 'код', minutes: 5, now: 0 });
  s.record(F, 90, 60_000);
  s.record(D, 30, 120_000);
  assert.strictEqual(s.focusScore(), 75);
  const ev = s.record(F, 2, 5 * 60_000);
  assert.ok(ev.includes('time-up'));
  const sum = s.summary(5 * 60_000);
  assert.strictEqual(sum.timeline[1], 'focus');
  assert.strictEqual(sum.timeline[2], 'distraction');
  assert.strictEqual(sum.topDistractors[0].label, 'Instagram');
});

const { applyIdle, IDLE_SEC } = require('../src/main/session');

test('бездействие на ленте считается «не за компьютером», напоминаний нет', () => {
  const s = new Session({ goal: 'код', minutes: 25, now: 0 });
  const away = applyIdle(D, IDLE_SEC + 1);
  assert.strictEqual(away.category, 'away');
  const events = [];
  for (let i = 1; i <= 30; i++) events.push(...s.record(away, 2, i * 2000));
  assert.deepStrictEqual(events, []);
  assert.strictEqual(s.totals.away, 60);
  assert.strictEqual(s.totals.distraction, 0);
  assert.strictEqual(s.focusScore(), 100);
});

test('бездействие не трогает фокус и видео', () => {
  assert.strictEqual(applyIdle(F, IDLE_SEC * 3).category, 'focus');
  assert.strictEqual(applyIdle({ category: 'distraction', label: 'Сериалы' }, IDLE_SEC * 3).category, 'distraction');
  assert.strictEqual(applyIdle(D, IDLE_SEC - 1).category, 'distraction');
});

test('поправка «это по работе» снимает напоминание без ложного возврата', () => {
  const s = new Session({ goal: 'код', minutes: 25, now: 0 });
  let t = 0;
  for (let i = 0; i < DRIFT_NUDGE_SEC / 2; i++) s.record(D, 2, (t += 2000));
  assert.strictEqual(s.nudges, 1);
  s.forgiveDrift();
  assert.strictEqual(s.nudges, 0);
  assert.deepStrictEqual(s.record(F, 2, (t += 2000)), []);
  assert.strictEqual(s.returns, 0);
});

test('блокировка: держится до конца времени, снимается сдачей', () => {
  const s = new Session({ goal: 'код', minutes: 45, strict: true, now: 0 });
  assert.strictEqual(s.isLocked(10 * 60000), true);
  assert.strictEqual(s.lockLeftSec(15 * 60000), 30 * 60);
  assert.strictEqual(s.isLocked(45 * 60000), false, 'время вышло');
  s.surrendered = true;
  assert.strictEqual(s.isLocked(10 * 60000), false);
  assert.strictEqual(new Session({ goal: 'код', minutes: 45, now: 0 }).isLocked(60000), false, 'без блокировки');
});

test('сдался досрочно: половина опыта, отметка в чеке', () => {
  const s = new Session({ goal: 'код', minutes: 45, strict: true, now: 0 });
  s.record(F, 20 * 60, 20 * 60000);
  s.shutdownAttempts = 2;
  s.surrendered = true;
  const sum = s.summary(20 * 60000);
  assert.strictEqual(sum.xpEarned, 10);
  assert.strictEqual(sum.shutdownAttempts, 2);
  assert.strictEqual(sum.surrendered, true);
});

test('снимок сессии восстанавливается после убийства процесса', () => {
  const s = new Session({ goal: 'код', minutes: 45, strict: true, now: 0 });
  s.record(F, 120, 120000);
  s.shutdownAttempts = 1;
  const r = Session.restore(JSON.parse(JSON.stringify(s.snapshot())));
  assert.strictEqual(r.goal, 'код');
  assert.strictEqual(r.totals.focus, 120);
  assert.strictEqual(r.isLocked(10 * 60000), true);
  assert.strictEqual(r.shutdownAttempts, 1);
  assert.strictEqual(typeof r.record, 'function');
});

const { earnedBreakMin } = require('../src/main/session');

test('перерыв зарабатывается фокусом: ~1 мин на 5 мин работы', () => {
  const m = (min) => earnedBreakMin(min * 60);
  assert.strictEqual(m(3), 0, 'меньше 5 мин фокуса — перерыв не заработан');
  assert.strictEqual(m(10), 2);
  assert.strictEqual(m(20), 4, '20 мин работы — 4 мин отдыха, а не 15');
  assert.strictEqual(m(25), 5);
  assert.strictEqual(m(50), 10);
  assert.strictEqual(m(75), 10, 'короткий перерыв не больше 10 мин');
  assert.strictEqual(m(90), 18, 'после 90 мин фокуса — длинный перерыв');
  assert.strictEqual(m(150), 20, 'и не больше 20 мин');
});

test('просьба о 15 мин после 20 мин работы урезается до заработанного', () => {
  const s = new Session({ goal: 'код', minutes: 20, now: 0 });
  s.record(F, 20 * 60, 20 * 60_000);
  const r = s.grantBreak(15, 20 * 60_000);
  assert.strictEqual(r.minutes, 4);
  assert.strictEqual(r.refused, false);
  assert.strictEqual(s.focusSinceBreak, 0, 'после перерыва копим заново');
  assert.strictEqual(s.grantBreak(5, 25 * 60_000).refused, true, 'второй перерыв подряд не заработан');
});

test('время в ленте перерыв не зарабатывает', () => {
  const s = new Session({ goal: 'код', minutes: 60, now: 0 });
  s.record(D, 30 * 60, 30 * 60_000);
  assert.strictEqual(s.earnedBreak(), 0);
  assert.strictEqual(s.grantBreak(0, 30 * 60_000).refused, true);
});

test('после 50 мин фокуса Акыл сам предлагает перерыв', () => {
  const s = new Session({ goal: 'код', minutes: 120, now: 0 });
  const ev = [];
  for (let t = 1; t <= 51; t++) ev.push(...s.record(F, 60, t * 60_000));
  assert.deepStrictEqual(
    ev.filter((e) => e === 'break-due'),
    ['break-due']
  );
});
