// Локальное хранилище: опыт (XP), уровень, история сессий. Всё лежит в JSON на устройстве пользователя.
const path = require('path');
const { writeJsonAtomic, readJsonSafe } = require('../shared/fsutil');
const { weeklyAdValue } = require('./attention-value');

const XP_PER_LEVEL = 25;

function levelFor(xp) {
  const level = Math.floor(Math.sqrt(xp / XP_PER_LEVEL)) + 1;
  return { level, nextLevelXp: level * level * XP_PER_LEVEL };
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Сдвиг на n календарных дней (через setDate, чтобы переход на летнее время не ломал счёт).
function shiftDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

// Сколько дней подряд были сессии. Если сегодня сессии ещё не было, серия считается от вчера,
// чтобы утром она не обнулялась раньше времени.
function streakDays(sessions, now = Date.now()) {
  const days = new Set(sessions.map((s) => dayKey(s.endedAt)));
  const start = days.has(dayKey(now)) ? 0 : 1;
  let streak = 0;
  while (days.has(dayKey(shiftDays(now, start + streak)))) streak++;
  return streak;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'nazar-data.json');
    const saved = readJsonSafe(this.file) || {};
    this.data = {
      xp: Number.isFinite(saved.xp) ? saved.xp : 0,
      sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
    };
  }

  save() {
    writeJsonAtomic(this.file, this.data);
  }

  addSession(summary) {
    const betDelta = summary.bet ? summary.bet.delta : 0;
    this.data.xp = Math.max(0, this.data.xp + summary.xpEarned + betDelta);
    this.data.sessions.unshift(summary);
    this.data.sessions = this.data.sessions.slice(0, 50);
    this.save();
  }

  /** Прогноз срыва по истории (или null, если срывов пока мало). */
  forecast() {
    return forecastOf(this.data.sessions);
  }

  /** «Счёт за внимание» за 7 дней и прогноз на год. */
  adValue(now = Date.now()) {
    return weeklyAdValue(this.data.sessions, now);
  }

  memory(now = Date.now()) {
    return memoryOf(this.data.sessions, now);
  }

  profile(now = Date.now()) {
    return {
      xp: this.data.xp,
      ...levelFor(this.data.xp),
      streak: streakDays(this.data.sessions, now),
      recent: this.data.sessions.slice(0, 7).map((s) => ({ goal: s.goal, focusScore: s.focusScore, endedAt: s.endedAt })),
    };
  }
}

// Что Акыл помнит о прошлых сессиях: средний фокус, главные «воры» за неделю, лучшее время дня.
function memoryOf(sessions, now = Date.now()) {
  if (!sessions.length) return null;
  const last10 = sessions.slice(0, 10);
  const avgFocus = Math.round(last10.reduce((sum, s) => sum + (s.focusScore || 0), 0) / last10.length);
  const weekAgo = now - 7 * 86400000;
  const week = sessions.filter((s) => s.endedAt >= weekAgo);
  const thieves = {};
  for (const s of week) for (const d of s.topDistractors || []) thieves[d.label] = (thieves[d.label] || 0) + d.sec;
  const topThieves = Object.entries(thieves)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, sec]) => ({ label, sec }));
  // Лучшее время дня: часть суток с самым высоким средним фокусом (нужно хотя бы 2 сессии в ней).
  const parts = { утро: [5, 12], день: [12, 17], вечер: [17, 23] };
  let bestTime = null;
  for (const [name, [from, to]] of Object.entries(parts)) {
    const inPart = sessions.slice(0, 30).filter((s) => {
      const h = new Date(s.startedAt || s.endedAt).getHours();
      return h >= from && h < to;
    });
    if (inPart.length < 2) continue;
    const avg = Math.round(inPart.reduce((sum, s) => sum + (s.focusScore || 0), 0) / inPart.length);
    if (!bestTime || avg > bestTime.avgFocus) bestTime = { name, avgFocus: avg };
  }
  const last = sessions[0];
  return {
    sessions: sessions.length,
    weekSessions: week.length,
    weekAdValue: weeklyAdValue(sessions, now).week,
    forecast: forecastOf(sessions),
    avgFocus,
    topThieves,
    bestTime,
    last: {
      goal: last.goal,
      focusScore: last.focusScore,
      topDistractor: last.topDistractors && last.topDistractors[0] ? last.topDistractors[0].label : null,
    },
  };
}

// Прогноз срыва по истории: на какой минуте непрерывной работы человек обычно уходит в ленту,
// из какого нейтрального окна (мессенджер, проводник…) и куда. Нужно хотя бы 3 срыва.
const FORECAST_MIN_SLIPS = 3;

function mode(values) {
  const counts = {};
  for (const v of values) if (v) counts[v] = (counts[v] || 0) + 1;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? { value: best[0], count: best[1] } : null;
}

function forecastOf(sessions) {
  const slips = sessions.slice(0, 30).flatMap((s) => s.slips || []);
  if (slips.length < FORECAST_MIN_SLIPS) return null;
  const mins = slips.map((x) => x.afterMin).sort((a, b) => a - b);
  const mid = Math.floor(mins.length / 2);
  const median = mins.length % 2 ? mins[mid] : (mins[mid - 1] + mins[mid]) / 2;
  const target = mode(slips.map((x) => x.to));
  // «Крючок» — только нейтральное окно, которое стоит перед срывом хотя бы в 40% случаев (и минимум дважды).
  const trig = mode(slips.filter((x) => x.beforeCat === 'neutral').map((x) => x.before));
  const trigger = trig && trig.count >= 2 && trig.count / slips.length >= 0.4 ? trig.value : null;
  return { typicalMin: Math.round(median), trigger, target: target ? target.value : null, slips: slips.length };
}

module.exports = { Store, levelFor, streakDays, memoryOf, forecastOf };
