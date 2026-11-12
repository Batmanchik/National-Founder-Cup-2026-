// Локальное хранилище: опыт (XP), уровень, история сессий. Всё лежит в JSON на устройстве пользователя.
const path = require('path');
const { writeJsonAtomic, readJsonSafe } = require('../shared/fsutil');

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
    this.data.xp += summary.xpEarned;
    this.data.sessions.unshift(summary);
    this.data.sessions = this.data.sessions.slice(0, 50);
    this.save();
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

module.exports = { Store, levelFor, streakDays, memoryOf };
