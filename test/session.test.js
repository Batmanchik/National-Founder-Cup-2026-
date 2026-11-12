const test = require('node:test');
const assert = require('node:assert');
const { Session, DRIFT_NUDGE_SEC } = require('../src/main/session');

const D = { category: 'distraction', label: 'Instagram' };
const F = { category: 'focus', label: 'Код' };

test('напоминание после порога отвлечения и возврат к цели', () => {
  const t0 = 1_000_000;
  const s = new Session({ goal: 'код', minutes: 25, now: t0 });
  let events = [];
  let t = t0;
  for (let i = 0; i < DRIFT_NUDGE_SEC / 2; i++) events.push(...s.record(D, 2, (t += 2000)));
  assert.deepStrictEqual(events, ['drift']);
  assert.deepStrictEqual(s.record(F, 2, (t += 2000)), ['back']);
  assert.strictEqual(s.returns, 1);
  assert.strictEqual(s.nudges, 1);
});

test('перерыв не считается отвлечением и заканчивается событием', () => {
  const t0 = 0;
  const s = new Session({ goal: 'код', minutes: 25, now: t0 });
  s.grantBreak(5, t0);
  s.record(D, 2, 60_000);
  assert.strictEqual(s.totals.break, 2);
  assert.strictEqual(s.totals.distraction, 0);
  assert.deepStrictEqual(s.record(F, 2, 5 * 60_000 + 1), ['break-over']);
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
  let events = [];
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
