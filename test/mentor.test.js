const test = require('node:test');
const assert = require('node:assert');
const mentor = require('../src/main/mentor');
const { memoryOf } = require('../src/main/store');
const { windowKeyword } = require('../src/main/classifier');

const DAY = 86400000;
const now = new Date(2026, 10, 12, 15).getTime();
const sess = (daysAgo, focusScore, thieves, hour = 15) => {
  const t = new Date(2026, 10, 12 - daysAgo, hour).getTime();
  return { goal: 'курсовая', focusScore, startedAt: t, endedAt: t + 25 * 60000, topDistractors: thieves };
};

test('память: средний фокус и главные воры недели', () => {
  const m = memoryOf(
    [
      sess(0, 60, [{ label: 'Instagram', sec: 300 }]),
      sess(1, 80, [{ label: 'Instagram', sec: 200 }, { label: 'Игры', sec: 100 }]),
      sess(9, 100, [{ label: 'Сериалы', sec: 900 }]),
    ],
    now
  );
  assert.strictEqual(m.avgFocus, 80);
  assert.strictEqual(m.weekSessions, 2);
  assert.deepStrictEqual(m.topThieves[0], { label: 'Instagram', sec: 500 });
  assert.ok(!m.topThieves.some((t) => t.label === 'Сериалы'), 'старше недели не считаем');
  assert.strictEqual(memoryOf([], now), null);
});

test('память: лучшее время дня', () => {
  const m = memoryOf([sess(0, 90, [], 9), sess(1, 85, [], 10), sess(2, 40, [], 20), sess(3, 50, [], 21)], now);
  assert.strictEqual(m.bestTime.name, 'утро');
});

test('офлайн-чат понимает поправки', () => {
  const ctx = { goal: 'курсовая', live: null };
  assert.strictEqual(mentor.offlineChat('Это по работе, запомни', ctx).action, 'mark_focus');
  assert.strictEqual(mentor.offlineChat('не ругайся, это не отвлечение', ctx).action, 'mark_focus');
  assert.strictEqual(mentor.offlineChat('запомни, это отвлечение', ctx).action, 'mark_distraction');
  assert.strictEqual(mentor.offlineChat('дай перерыв 5 минут', ctx).action, 'break');
  assert.strictEqual(mentor.offlineChat('я не закончил', ctx).action, 'none');
});

test('офлайн-чат: сколько осталось и сравнение со средним', () => {
  const live = { remainingSec: 600, focusScore: 90, totals: { focus: 900, distraction: 100 } };
  assert.match(mentor.offlineChat('сколько осталось?', { goal: 'g', live }).reply, /10 мин/);
  const r = mentor.offlineChat('как я?', { goal: 'g', live, memory: { sessions: 5, avgFocus: 70, topThieves: [] } }).reply;
  assert.match(r, /выше твоего среднего \(70%\)/);
});

test('повторное отвлечение получает другую реплику', () => {
  const line = mentor.driftLine({ goal: 'g', label: 'Instagram', nudges: 3, memory: null });
  assert.match(line, /3-й раз/);
});

test('старт сессии вспоминает главного вора недели', () => {
  const mem = { topThieves: [{ label: 'Instagram', sec: 600 }], last: null };
  assert.match(mentor.startLine('курсовая', mem), /Instagram/);
  assert.doesNotMatch(mentor.startLine('курсовая', null), /undefined/);
});

test('вывод без ИИ сравнивает со средним и замечает привычного вора', () => {
  const summary = { focusScore: 90, topDistractors: [{ label: 'Instagram', sec: 120 }] };
  const text = mentor.offlineInsight(summary, { sessions: 4, avgFocus: 70, topThieves: [{ label: 'Instagram', sec: 900 }], bestTime: null });
  assert.match(text, /выше твоего среднего/);
  assert.match(text, /не первый раз/);
});

test('ключ окна для запоминания', () => {
  assert.strictEqual(windowKeyword({ app: 'chrome', title: 'Лекция по физике: механика - YouTube - Google Chrome' }), 'Лекция по физике: механика');
  assert.strictEqual(windowKeyword({ app: 'chrome', title: 'Механика - YouTube', url: 'https://www.youtube.com/watch?v=1' }), 'Механика');
  assert.strictEqual(windowKeyword({ app: 'chrome', title: '', url: 'https://www.khanacademy.org/math' }), 'khanacademy.org');
  assert.strictEqual(windowKeyword({ app: 'Telegram', title: '' }), 'Telegram');
});
