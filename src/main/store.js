// Локальное хранилище: опыт (XP), уровень, история сессий. Всё лежит в JSON на устройстве пользователя.
const fs = require('fs');
const path = require('path');

const XP_PER_LEVEL = 25;

function levelFor(xp) {
  const level = Math.floor(Math.sqrt(xp / XP_PER_LEVEL)) + 1;
  return { level, nextLevelXp: level * level * XP_PER_LEVEL };
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Сколько дней подряд (включая сегодня) были сессии.
function streakDays(sessions, now = Date.now()) {
  const days = new Set(sessions.map((s) => dayKey(s.endedAt)));
  let streak = 0;
  for (let i = 0; ; i++) {
    if (days.has(dayKey(now - i * 86400000))) streak++;
    else if (i > 0 || streak > 0) break;
    else break;
  }
  return streak;
}

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'nazar-data.json');
    this.data = { xp: 0, sessions: [] };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      /* первый запуск */
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
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
