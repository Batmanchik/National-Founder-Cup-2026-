// Фокус-сессия: копит время по категориям и решает, когда ментору реагировать.
// Чистая логика без Electron — её покрывают тесты в test/session.test.js.
const { clamp } = require('../shared/util');
const { adValue } = require('./attention-value');

const DRIFT_NUDGE_SEC = Number(process.env.NAZAR_DRIFT_SEC) || 20; // через сколько секунд отвлечения ментор вмешивается
const DRIFT_LONG_SEC = 120; // второе, более настойчивое напоминание
const IDLE_SEC = 180; // сколько секунд без мыши и клавиатуры считать «нет за компьютером»
// Видео можно смотреть, ничего не нажимая, поэтому для них бездействие не значит «ушёл».
const PASSIVE_LABELS = /сериал|стрим|youtube|созвон|по цели/i;

// Поправка вердикта на бездействие. Фокус не трогаем (человек может читать или смотреть лекцию).
function applyIdle(verdict, idleSec) {
  if (!verdict || idleSec < IDLE_SEC) return verdict;
  if (verdict.category === 'focus' || PASSIVE_LABELS.test(verdict.label || '')) return verdict;
  return { category: 'away', label: 'Нет за компьютером', reason: `нет активности ${Math.round(idleSec / 60)} мин`, soft: false };
}

// Перерывы по исследованиям, а не «сколько попросишь»:
//  • систематические перерывы ~1 мин на 4–5 мин работы (12/3, 24/6) дают меньше усталости и лучше концентрацию,
//    чем перерывы «когда захочется» (Biwer et al., 2023, Br J Educ Psychol);
//  • короткие перерывы до 10 мин снижают усталость, после тяжёлой работы нужно больше 10 мин (Albulescu et al., 2022, PLOS ONE);
//  • Flowtime масштабирует отдых по объёму работы: 25 мин → 5, 50 → 8–10, 90+ → 15.
// Поэтому перерыв зарабатывается фокусом с прошлого перерыва: 1 мин на 5 мин по делу,
// не больше 10 мин, а после 90 мин непрерывного фокуса — до 20 мин. Время в ленте перерыв не зарабатывает.
const WORK_PER_BREAK_MIN = 5;
const MIN_FOCUS_FOR_BREAK = 5; // меньше 5 мин фокуса — перерыв ещё не заработан
const MAX_SHORT_BREAK = 10;
const LONG_FOCUS_MIN = 90;
const MAX_LONG_BREAK = 20;
const BREAK_DUE_AT_MIN = [50, 90]; // когда Акыл сам предлагает передышку

// «Ставка на себя»: человек ставит свои баллы, что продержит фокус до конца таймера.
// Добровольная ставка с ценой за срыв — тот же механизм, что в эксперименте Allcott et al. (2022, AER):
// когда люди сами ставили себе ограничение, использование соцсетей заметно снижалось.
const BET_TARGET = 80; // нужный процент фокуса
const BET_WARN_AFTER_MIN = 5; // раньше предупреждать бессмысленно: процент ещё скачет

function earnedBreakMin(focusSec) {
  const focusMin = focusSec / 60;
  if (focusMin < MIN_FOCUS_FOR_BREAK) return 0;
  const cap = focusMin >= LONG_FOCUS_MIN ? MAX_LONG_BREAK : MAX_SHORT_BREAK;
  return Math.min(cap, Math.max(1, Math.round(focusMin / WORK_PER_BREAK_MIN)));
}

class Session {
  constructor({ goal, minutes, driftSec, strict = false, bet = 0, now = Date.now() }) {
    this.id = String(now);
    this.setDriftSec(driftSec);
    this.goal = String(goal || '').trim() || 'Без цели';
    this.plannedMin = clamp(minutes || 25, 5, 240);
    this.startedAt = now;
    this.endedAt = null;
    this.totals = { focus: 0, distraction: 0, neutral: 0, break: 0, away: 0 };
    this.apps = {}; // label -> секунды
    this.distractors = {}; // label -> секунды отвлечения
    this.timeline = []; // по минутам: { focus, distraction, neutral, break, away }
    this.driftStreak = 0;
    this.driftNotified = false;
    this.longNotified = false;
    this.timeUpNotified = false;
    this.nudges = 0;
    this.returns = 0;
    this.breaks = 0;
    this.breakUntil = 0;
    this.focusSinceBreak = 0; // секунд фокуса с прошлого перерыва — из них «зарабатывается» отдых
    this.breakDueShown = 0; // сколько порогов BREAK_DUE_AT_MIN уже предложено с прошлого перерыва
    this.strict = Boolean(strict); // блокировка выключения: до конца сессии Акыла не выключить
    this.shutdownAttempts = 0; // сколько раз пытались выключить или закрыть
    this.surrendered = false; // сдался досрочно
    this.bet = Math.max(0, Math.floor(Number(bet) || 0)); // баллы на кону (что не больше баланса, проверяет main)
    this.betWarned = false;
  }

  // Восстановить сессию из снимка (после того как Nazar убили через диспетчер задач).
  static restore(data) {
    const s = new Session({ goal: data.goal, minutes: data.plannedMin, driftSec: data.driftNudgeSec, now: data.startedAt });
    return Object.assign(s, data);
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this));
  }

  // Итог ставки: выиграл, если дотянул до конца таймера, не сдался и фокус ≥ 80%. Выигрыш = ставка (итого ×2).
  betResult(now = Date.now()) {
    if (!this.bet) return null;
    const won = this.isTimeUp(now) && !this.surrendered && this.focusScore() >= BET_TARGET;
    const reason = won ? 'won' : this.surrendered ? 'surrendered' : !this.isTimeUp(now) ? 'early' : 'focus';
    return { stake: this.bet, target: BET_TARGET, won, reason, delta: won ? this.bet : -this.bet };
  }

  isTimeUp(now = Date.now()) {
    return now - this.startedAt >= this.plannedMin * 60000;
  }

  // Сессия заблокирована: включена блокировка и время ещё не вышло.
  isLocked(now = Date.now()) {
    return this.strict && !this.surrendered && !this.isTimeUp(now);
  }

  lockLeftSec(now = Date.now()) {
    return Math.max(0, Math.round((this.startedAt + this.plannedMin * 60000 - now) / 1000));
  }

  setDriftSec(sec) {
    this.driftNudgeSec = Number(sec) || DRIFT_NUDGE_SEC;
    this.driftLongSec = Math.max(DRIFT_LONG_SEC, this.driftNudgeSec * 2);
  }

  isOnBreak(now = Date.now()) {
    return now < this.breakUntil;
  }

  _bucket(now) {
    const idx = Math.floor((now - this.startedAt) / 60000);
    while (this.timeline.length <= idx) this.timeline.push({ focus: 0, distraction: 0, neutral: 0, break: 0, away: 0 });
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

    const cat = verdict.category in this.totals && verdict.category !== 'break' ? verdict.category : 'neutral';
    this.totals[cat] += dt;
    bucket[cat] += dt;
    if (cat !== 'away') this.apps[verdict.label] = (this.apps[verdict.label] || 0) + dt;

    if (cat === 'distraction') {
      this.distractors[verdict.label] = (this.distractors[verdict.label] || 0) + dt;
      this.driftStreak += dt;
      if (!this.driftNotified && this.driftStreak >= this.driftNudgeSec) {
        this.driftNotified = true;
        this.nudges += 1;
        events.push('drift');
      } else if (this.driftNotified && !this.longNotified && this.driftStreak >= this.driftLongSec) {
        this.longNotified = true;
        events.push('drift-long');
      }
    } else if (cat === 'focus') {
      this.focusSinceBreak += dt;
      const due = BREAK_DUE_AT_MIN[this.breakDueShown];
      if (due && this.focusSinceBreak >= due * 60) {
        this.breakDueShown += 1;
        events.push('break-due');
      }
      if (this.driftNotified) {
        this.returns += 1;
        events.push('back');
      }
      this.driftStreak = 0;
      this.driftNotified = false;
      this.longNotified = false;
    } else if (cat === 'away') {
      // Человек отошёл: напоминать некому. Когда вернётся, счёт отвлечения начнётся заново.
      this.driftStreak = 0;
      this.driftNotified = false;
      this.longNotified = false;
    }
    // neutral: счётчик отвлечения замирает, но не сбрасывается

    // Ставка под угрозой: фокус просел ниже порога — один раз предупреждаем, снова только после того, как поднялся.
    if (this.bet && now - this.startedAt >= BET_WARN_AFTER_MIN * 60000) {
      const below = this.focusScore() < BET_TARGET;
      if (below && !this.betWarned) {
        this.betWarned = true;
        events.push('bet-danger');
      } else if (!below && this.focusScore() >= BET_TARGET + 5) this.betWarned = false;
    }

    if (!this.timeUpNotified && now - this.startedAt >= this.plannedMin * 60000) {
      this.timeUpNotified = true;
      events.push('time-up');
    }
    return events;
  }

  // Пользователь поправил Акыла («это по работе»): текущее отвлечение не считаем срывом.
  forgiveDrift() {
    if (this.driftNotified && this.nudges > 0) this.nudges -= 1;
    this.driftStreak = 0;
    this.driftNotified = false;
    this.longNotified = false;
  }

  // Сколько минут перерыва заработано сейчас.
  earnedBreak() {
    return earnedBreakMin(this.focusSinceBreak);
  }

  // Просьба о перерыве: выдаём не больше заработанного. Без числа — ровно заработанное.
  // Возвращает { minutes, requested, earned, focusMin, refused }.
  grantBreak(requested, now = Date.now()) {
    const earned = this.earnedBreak();
    const focusMin = Math.round(this.focusSinceBreak / 60);
    const want = Math.round(Number(requested)) || 0;
    if (!earned)
      return {
        minutes: 0,
        requested: want,
        earned,
        focusMin,
        refused: true,
        needMin: MIN_FOCUS_FOR_BREAK - Math.floor(this.focusSinceBreak / 60),
      };
    const minutes = want > 0 ? Math.min(want, earned) : earned;
    this.breakUntil = now + minutes * 60000;
    this.breaks += 1;
    this.focusSinceBreak = 0;
    this.breakDueShown = 0;
    return { minutes, requested: want, earned, focusMin, refused: false };
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
      locked: this.isLocked(now),
      lockLeftSec: this.lockLeftSec(now),
      breakLeftSec: Math.max(0, Math.round((this.breakUntil - now) / 1000)),
      breakEarnedMin: this.earnedBreak(),
      bet: this.bet ? { stake: this.bet, target: BET_TARGET, onTrack: this.focusScore() >= BET_TARGET } : null,
      adValue: adValue(this.distractors).tenge,
      focusSinceBreakMin: Math.round(this.focusSinceBreak / 60),
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
    let xpEarned = Math.round(this.totals.focus / 60) + this.returns * 5 + (score >= 80 && elapsedMin >= 10 ? 20 : 0);
    if (this.surrendered) xpEarned = Math.floor(Math.round(this.totals.focus / 60) / 2); // сдался: половина за минуты, без бонусов
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
      strict: this.strict,
      shutdownAttempts: this.shutdownAttempts,
      surrendered: this.surrendered,
      topDistractors: top(this.distractors),
      adValue: Math.round(adValue(this.distractors).tenge * 10) / 10, // «счёт за внимание», ₸
      bet: this.betResult(now),
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

module.exports = { Session, applyIdle, earnedBreakMin, BET_TARGET, DRIFT_NUDGE_SEC, DRIFT_LONG_SEC, IDLE_SEC };
