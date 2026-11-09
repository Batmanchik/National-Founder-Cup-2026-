// Фокус-сессия: копит время по категориям и решает, когда ментору реагировать.
// Чистая логика без Electron — её покрывают тесты в test/session.test.js.

const DRIFT_NUDGE_SEC = Number(process.env.NAZAR_DRIFT_SEC) || 20; // через сколько секунд отвлечения ментор вмешивается
const DRIFT_LONG_SEC = 120; // второе, более настойчивое напоминание

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

class Session {
  constructor({ goal, minutes, now = Date.now() }) {
    this.id = String(now);
    this.goal = String(goal || '').trim() || 'Без цели';
    this.plannedMin = clamp(minutes || 25, 5, 240);
    this.startedAt = now;
    this.endedAt = null;
    this.totals = { focus: 0, distraction: 0, neutral: 0, break: 0 };
    this.apps = {}; // label -> секунды
    this.distractors = {}; // label -> секунды отвлечения
    this.timeline = []; // по минутам: { focus, distraction, neutral, break }
    this.driftStreak = 0;
    this.driftNotified = false;
    this.longNotified = false;
    this.timeUpNotified = false;
    this.nudges = 0;
    this.returns = 0;
    this.breaks = 0;
    this.breakUntil = 0;
  }

  isOnBreak(now = Date.now()) {
    return now < this.breakUntil;
  }

  _bucket(now) {
    const idx = Math.floor((now - this.startedAt) / 60000);
    while (this.timeline.length <= idx) this.timeline.push({ focus: 0, distraction: 0, neutral: 0, break: 0 });
    return this.timeline[idx];
  }

  // Учесть dt секунд в текущем окне. Возвращает список событий для ментора.
  record(verdict, dt, now = Date.now()) {
    const events = [];
    if (this.breakUntil && now >= this.breakUntil) {
      this.breakUntil = 0;
      this.driftStreak = 0;
      this.driftNotified = false;
      this.longNotified = false;
      events.push('break-over');
    }

    const bucket = this._bucket(now);
    if (this.isOnBreak(now)) {
      this.totals.break += dt;
      bucket.break += dt;
      return events;
    }

    const cat = verdict.category;
    this.totals[cat] += dt;
    bucket[cat] += dt;
    this.apps[verdict.label] = (this.apps[verdict.label] || 0) + dt;

    if (cat === 'distraction') {
      this.distractors[verdict.label] = (this.distractors[verdict.label] || 0) + dt;
      this.driftStreak += dt;
      if (!this.driftNotified && this.driftStreak >= DRIFT_NUDGE_SEC) {
        this.driftNotified = true;
        this.nudges += 1;
        events.push('drift');
      } else if (this.driftNotified && !this.longNotified && this.driftStreak >= DRIFT_LONG_SEC) {
        this.longNotified = true;
        events.push('drift-long');
      }
    } else if (cat === 'focus') {
      if (this.driftNotified) {
        this.returns += 1;
        events.push('back');
      }
      this.driftStreak = 0;
      this.driftNotified = false;
      this.longNotified = false;
    }
    // neutral: счётчик отвлечения замирает, но не сбрасывается

    if (!this.timeUpNotified && now - this.startedAt >= this.plannedMin * 60000) {
      this.timeUpNotified = true;
      events.push('time-up');
    }
    return events;
  }

  grantBreak(minutes, now = Date.now()) {
    const m = clamp(minutes, 1, 15);
    this.breakUntil = now + m * 60000;
    this.breaks += 1;
    return m;
  }

  extend(minutes) {
    const m = clamp(minutes, 5, 60);
    this.plannedMin += m;
    this.timeUpNotified = false;
    return m;
  }

  focusScore() {
    const t = this.totals.focus + this.totals.distraction;
    return t ? Math.round((100 * this.totals.focus) / t) : 100;
  }

  live(now = Date.now()) {
    const elapsedSec = Math.round((now - this.startedAt) / 1000);
    return {
      goal: this.goal,
      plannedMin: this.plannedMin,
      elapsedSec,
      remainingSec: Math.max(0, this.plannedMin * 60 - elapsedSec),
      focusScore: this.focusScore(),
      totals: { ...this.totals },
      onBreak: this.isOnBreak(now),
      breakLeftSec: Math.max(0, Math.round((this.breakUntil - now) / 1000)),
      driftStreak: this.driftStreak,
    };
  }

  summary(now = Date.now()) {
    const top = (obj) =>
      Object.entries(obj)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([label, sec]) => ({ label, sec }));
    const score = this.focusScore();
    const elapsedMin = (now - this.startedAt) / 60000;
    const xpEarned =
      Math.round(this.totals.focus / 60) + this.returns * 5 + (score >= 80 && elapsedMin >= 10 ? 20 : 0);
    return {
      id: this.id,
      goal: this.goal,
      plannedMin: this.plannedMin,
      startedAt: this.startedAt,
      endedAt: now,
      elapsedMin: Math.round(elapsedMin),
      totals: { ...this.totals },
      focusScore: score,
      nudges: this.nudges,
      returns: this.returns,
      breaks: this.breaks,
      topDistractors: top(this.distractors),
      topApps: top(this.apps),
      timeline: this.timeline.map((b) => {
        const entries = Object.entries(b).filter(([, v]) => v > 0);
        if (!entries.length) return 'neutral';
        return entries.sort((x, y) => y[1] - x[1])[0][0];
      }),
      xpEarned,
    };
  }
}

module.exports = { Session, DRIFT_NUDGE_SEC, DRIFT_LONG_SEC };
