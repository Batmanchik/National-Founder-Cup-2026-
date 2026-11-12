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

  profile(now = Date.now()) {
    return {
      xp: this.data.xp,
      ...levelFor(this.data.xp),
      streak: streakDays(this.data.sessions, now),
      recent: this.data.sessions.slice(0, 7).map((s) => ({ goal: s.goal, focusScore: s.focusScore, endedAt: s.endedAt })),
    };
  }
}

module.exports = { Store, levelFor, streakDays };
