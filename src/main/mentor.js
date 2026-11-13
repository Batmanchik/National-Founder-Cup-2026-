// «Мозг» ментора Акыла.
// С ключом ANTHROPIC_API_KEY использует Claude: чат с действиями, оценку окна, анализ скриншота, вывод по сессии.
// Без ключа работает офлайн на шаблонах, поэтому демо не ломается без интернета.
const Anthropic = require('@anthropic-ai/sdk').default;
const { clamp, pick, fmtMin, fmtTenge, minutesAcc } = require('../shared/util');
const { TIPS, setCustomLines } = require('./lines');

let MODEL = process.env.NAZAR_MODEL || 'claude-opus-5-5';
// Модели, для которых включаем серверный фолбэк при отказе (refusal).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

let client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
let useFallbacks = FALLBACK_MODELS.has(MODEL);

// Применяет настройки на лету. Ключ из настроек важнее ключа из .env.
function configure({ apiKey, model, lines } = {}) {
  if (model) MODEL = model;
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  client = key ? new Anthropic({ apiKey: key }) : null;
  useFallbacks = FALLBACK_MODELS.has(MODEL);
  setCustomLines(lines);
}

const PERSONA = `Ты — Акыл, маленький пиксельный ментор приложения Nazar. Ты живёшь внизу экрана ноутбука пользователя.
Твоя задача: помочь человеку удержать цель, которую он сам назвал, и честно показывать, куда уходит его внимание.
Характер: бодрый и напористый, подгоняет как тренер («давай-давай, работай-работай!», «темп, темп!»), но в душе болеет за человека. Хвалит коротко («красава!»). Не унижает и не морализирует. Без спортивных метафор: не говори про свисток, поле, тренировку, раздевалку.
Пиши очень коротко: 1–2 предложения, максимум 25 слов. Отвечай на языке пользователя (русский или казахский).
Никогда не выдумывай, что видел на экране, если этого нет в контексте.`;

const ACTIONS = ['none', 'break', 'end_session', 'extend', 'mark_focus', 'mark_distraction'];

const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Реплика Акыла пользователю' },
    action: {
      type: 'string',
      enum: ACTIONS,
      description:
        'break — дать перерыв; end_session — человек закончил; extend — продлить сессию; ' +
        'mark_focus — человек говорит, что текущее окно нужно для работы; mark_distraction — что это отвлечение',
    },
    minutes: { type: 'integer', description: 'Минуты для break (1–15) или extend (5–60), иначе 0' },
    keyword: {
      type: 'string',
      description:
        'Для mark_*: короткое слово или сайт из текущего окна, по которому узнавать его в будущем (например «khanacademy» или «Лекция по физике»). Иначе пустая строка',
    },
  },
  required: ['reply', 'action', 'minutes', 'keyword'],
  additionalProperties: false,
};

const WINDOW_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['focus', 'distraction', 'neutral'] },
    reason: { type: 'string' },
  },
  required: ['category', 'reason'],
  additionalProperties: false,
};

const SCREEN_SCHEMA = {
  type: 'object',
  properties: {
    on_task: { type: 'boolean', description: 'Работает ли человек над своей целью' },
    activity: { type: 'string', description: 'Что делает человек, до 8 слов' },
    confidence: { type: 'number', description: 'Уверенность от 0 до 1' },
    comment: { type: 'string', description: 'Короткая реплика Акыла, если человек отвлёкся, иначе пустая строка' },
  },
  required: ['on_task', 'activity', 'confidence', 'comment'],
  additionalProperties: false,
};

// Один вызов Claude. schema -> возвращает распарсенный JSON (structured outputs), иначе текст.
async function callClaude({ system, messages, schema, maxTokens = 2000 }) {
  if (!client) return null;
  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: { effort: 'low', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  if (useFallbacks) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  let resp;
  try {
    resp = await client.beta.messages.create(params);
  } catch (err) {
    if (useFallbacks && err instanceof Anthropic.BadRequestError) {
      // Аккаунт/платформа не поддерживает фолбэк — повторяем без него.
      useFallbacks = false;
      return callClaude({ system, messages, schema, maxTokens });
    }
    console.error('[mentor] Claude error:', err.status || '', err.message);
    return null;
  }
  if (resp.stop_reason === 'refusal') return null;
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (!schema) return text || null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function contextText(ctx) {
  const lines = [`Цель пользователя: «${ctx.goal || 'не задана'}».`];
  if (ctx.live) {
    const l = ctx.live;
    lines.push(
      `Прошло ${fmtMin(l.elapsedSec)} из ${l.plannedMin} мин. Фокус ${l.focusScore}%. ` +
        `По делу ${fmtMin(l.totals.focus)}, отвлечения ${fmtMin(l.totals.distraction)}.` +
        (l.bet ? ` Человек поставил ${l.bet.stake} баллов, что удержит фокус ${l.bet.target}%+ до конца таймера.` : '') +
        (l.onBreak
          ? ' Сейчас перерыв.'
          : ` С прошлого перерыва ${l.focusSinceBreakMin} мин фокуса, заработано ${l.breakEarnedMin} мин отдыха.`)
    );
  }
  if (ctx.window && (ctx.window.app || ctx.window.title)) {
    lines.push(`Сейчас открыто: ${ctx.window.app} — «${ctx.window.title}»${ctx.window.url ? ` (${ctx.window.url})` : ''}.`);
  }
  if (ctx.vision && ctx.vision.activity) lines.push(`По последнему скриншоту: ${ctx.vision.activity}.`);
  const mem = memoryText(ctx.memory);
  if (mem) lines.push(mem);
  return lines.join('\n');
}

// Память о прошлых сессиях в одну-две строки для Claude.
function memoryText(m) {
  if (!m) return '';
  const parts = [`Прошлые сессии: всего ${m.sessions}, за неделю ${m.weekSessions}, средний фокус ${m.avgFocus}%.`];
  if (m.weekAdValue >= 1)
    parts.push(`«Счёт за внимание»: за неделю платформы заработали на нём около ${fmtTenge(m.weekAdValue)} рекламой (оценка).`);
  if (m.topThieves.length)
    parts.push(`Главные отвлечения за неделю: ${m.topThieves.map((t) => `${t.label} ${fmtMin(t.sec)}`).join(', ')}.`);
  if (m.bestTime)
    parts.push(
      `Лучше всего фокус ${m.bestTime.name === 'день' ? 'днём' : m.bestTime.name === 'утро' ? 'утром' : 'вечером'} (${m.bestTime.avgFocus}%).`
    );
  if (m.last) parts.push(`Прошлая сессия: «${m.last.goal}», фокус ${m.last.focusScore}%.`);
  return parts.join(' ');
}

// Офлайн-чат: понимает базовые просьбы по ключевым словам.
function offlineChat(text, ctx) {
  const t = text.toLowerCase();
  const num = Number((t.match(/\d+/) || [])[0]) || 0;
  if (/перерыв|отдох|устал|демалыс/.test(t)) {
    // Сколько дать — решает сессия по заработанному фокусу; здесь только запоминаем, сколько попросили (0 = сколько заслужил).
    return { reply: '', action: 'break', minutes: clamp(num, 0, 60) };
  }
  // Поправки: «это по работе», «это не отвлечение», «это тоже отвлечение».
  if (/не\s+отвлеч|по\s+работе|по\s+делу|для\s+(учёбы|учебы|работы|курсов|проекта)|это\s+(лекция|урок|нужно)|жұмыс/.test(t))
    return { reply: '', action: 'mark_focus', minutes: 0, keyword: '' };
  if (/(это|тоже|запомни).{0,15}отвлеч/.test(t)) return { reply: '', action: 'mark_distraction', minutes: 0, keyword: '' };
  const negated = /(^|\s)не\s+(всё\s+)?(законч|сделал|готов)/.test(t);
  if (!negated && /законч|готово|сделал|(^|\s)всё[.!]*$|бітті/.test(t))
    return { reply: 'Отлично! Сейчас покажу твой чек внимания.', action: 'end_session', minutes: 0 };
  if (/продл|ещё|еще|больше времени/.test(t)) {
    const m = clamp(num || 15, 5, 60);
    return { reply: `Добавил ${minutesAcc(m)}. Держим темп!`, action: 'extend', minutes: m };
  }
  if (/на мне.{0,20}заработ|заработ.{0,20}на мне|сч[её]т за внимание|стоит мо[её] внимание|тенге/.test(t)) {
    const now = ctx.live ? ctx.live.adValue : 0;
    const week = ctx.memory ? ctx.memory.weekAdValue : 0;
    const parts = [`За эту сессию платформы заработали на тебе ${fmtTenge(now)}.`];
    if (week >= 1) parts.push(`За неделю ${fmtTenge(week)}, за год в таком темпе ${fmtTenge(week * 52)}.`);
    parts.push('А ты от них получил 0 ₸.');
    return { reply: parts.join(' '), action: 'none', minutes: 0 };
  }
  if (/осталось|сколько времени|таймер/.test(t) && ctx.live) {
    return { reply: `Осталось ${fmtMin(ctx.live.remainingSec)}. Фокус пока ${ctx.live.focusScore}%.`, action: 'none', minutes: 0 };
  }
  if (/как я|статист|сколько/.test(t) && ctx.live) {
    const l = ctx.live;
    const m = ctx.memory;
    const cmp =
      m && m.sessions >= 2
        ? l.focusScore >= m.avgFocus
          ? ` Это выше твоего среднего (${m.avgFocus}%) 🔥`
          : ` Твой средний ${m.avgFocus}%, догоняем.`
        : '';
    const bet = !l.bet
      ? ''
      : l.bet.onTrack
        ? ` 🎲 Ставка ${l.bet.stake} баллов пока в силе.`
        : ` 🎲 Ставка ${l.bet.stake} баллов горит: нужно ${l.bet.target}%!`;
    return {
      reply: `Фокус ${l.focusScore}%: по делу ${fmtMin(l.totals.focus)}, отвлечения ${fmtMin(l.totals.distraction)}.${cmp}${bet}`,
      action: 'none',
      minutes: 0,
    };
  }
  if (/совет|помоги|не могу|лень|скучно|не получается|мотивац/.test(t)) {
    const m = ctx.memory;
    if (m && m.topThieves[0] && Math.random() < 0.5)
      return {
        reply: `Главный вор этой недели — ${m.topThieves[0].label}. Закрой его и возвращайся к «${ctx.goal}».`,
        action: 'none',
        minutes: 0,
      };
    return { reply: pick(TIPS), action: 'none', minutes: 0 };
  }
  if (/что умеешь|помощь|help|команды/.test(t)) {
    return {
      reply: 'Могу: «дай перерыв» (сколько заслужил), «продли на 15», «как я?», «сколько осталось», «это по работе», «я закончил».',
      action: 'none',
      minutes: 0,
    };
  }
  if (/привет|салем|сәлем|hi\b|hello/.test(t)) return { reply: `Салем! Держим курс на «${ctx.goal}».`, action: 'none', minutes: 0 };
  return {
    reply: `Я офлайн-версия, но слежу за целью «${ctx.goal}». Напиши «что умеешь» или добавь ключ Claude — стану умнее.`,
    action: 'none',
    minutes: 0,
  };
}

async function chat(history, text, ctx) {
  const messages = [
    ...history.slice(-10),
    { role: 'user', content: `[Контекст]\n${contextText(ctx)}\n\n[Сообщение пользователя]\n${text}` },
  ];
  const system = `${PERSONA}
Ты можешь выполнить действие: дать перерыв (action=break; minutes — сколько человек попросил, 0 если не назвал; приложение само урежет до заработанного: ~1 мин на 5 мин фокуса, до 10 мин, после 90 мин фокуса до 20), завершить сессию (end_session, если человек говорит, что закончил), продлить сессию (extend, 5–60 минут).
Если человек говорит, что текущее окно нужно для работы («это по учёбе», «не ругайся, это лекция»), поставь action=mark_focus и keyword. Если просит считать окно отвлечением — mark_distraction. keyword бери из текущего окна: сайт или 1–4 слова заголовка, которые узнают именно этот материал, а не весь YouTube.
В остальных случаях action=none, minutes=0, keyword пустой.
Если человек просит отвлечься без причины — можно договориться о коротком перерыве, но напомни про цель.
Используй память о прошлых сессиях, когда это к месту: сравни с его средним, назови его главного «вора», но не повторяйся каждый раз.`;
  const res = await callClaude({ system, messages, schema: CHAT_SCHEMA });
  if (res && typeof res.reply === 'string' && ACTIONS.includes(res.action)) return { ...res, ai: true };
  return { ...offlineChat(text, ctx), ai: false };
}

// Обещание с таймаутом: если ИИ думает дольше ms, возвращаем null и берём шаблон.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

// Личное напоминание от ИИ для затянувшегося отвлечения: учитывает цель, окно, статистику и память.
async function nudge(ctx) {
  if (!client) return null;
  const text = await withTimeout(
    callClaude({
      system: `${PERSONA}\nЧеловек уже пару минут отвлекается. Напиши одно короткое личное напоминание (до 20 слов): назови, что именно он смотрит, и мягко верни к цели. Можно предложить честный перерыв. Без кавычек.`,
      messages: [{ role: 'user', content: contextText(ctx) }],
      maxTokens: 400,
    }),
    5000
  );
  return text ? text.replace(/^["«]|["»]$/g, '').trim() : null;
}

// ИИ решает, связано ли «непонятное» окно (YouTube, мессенджер, сайт) с целью.
async function classifyWindow(goal, win) {
  const res = await callClaude({
    system:
      'Ты классифицируешь активное окно пользователя относительно его цели. focus — помогает цели; distraction — развлечение не по теме; neutral — служебное или коротко нужное.',
    messages: [{ role: 'user', content: `Цель: «${goal}».\nПриложение: ${win.app}\nЗаголовок: ${win.title}\nURL: ${win.url || '—'}` }],
    schema: WINDOW_SCHEMA,
    maxTokens: 1000,
  });
  return res && ['focus', 'distraction', 'neutral'].includes(res.category) ? res : null;
}

// Анализ скриншота экрана (только если пользователь включил «зрение»).
async function analyzeScreen(goal, win, jpegBase64) {
  return callClaude({
    system: `${PERSONA}\nСейчас ты смотришь на скриншот экрана пользователя. Маленький пиксельный человечек внизу — это ты, игнорируй его.`,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
          {
            type: 'text',
            text: `Цель пользователя: «${goal}». Активное окно: ${win.app} — «${win.title}».
Определи, работает ли человек над целью. Обучающее видео или статья по теме цели — это работа. Рилсы, шортсы, игры, ленты не по теме — отвлечение.`,
          },
        ],
      },
    ],
    schema: SCREEN_SCHEMA,
    maxTokens: 1500,
  });
}

// Персональный вывод по итогам сессии.
async function reportInsight(summary, memory = null) {
  const top = summary.topDistractors.map((d) => `${d.label} (${fmtMin(d.sec)})`).join(', ') || 'нет';
  const text = await callClaude({
    system: `${PERSONA}\nСейчас ты подводишь итог фокус-сессии. 2–3 коротких предложения: что получилось, где утекло внимание, один конкретный совет на следующий раз.`,
    messages: [
      {
        role: 'user',
        content: `Цель: «${summary.goal}». Длительность ${summary.elapsedMin} мин (план ${summary.plannedMin}). Фокус ${summary.focusScore}%.
По делу ${fmtMin(summary.totals.focus)}, отвлечения ${fmtMin(summary.totals.distraction)}, нейтрально ${fmtMin(summary.totals.neutral)}, перерывы ${fmtMin(summary.totals.break)}, не за компьютером ${fmtMin(summary.totals.away || 0)}.
Главные отвлечения: ${top}. Напоминаний: ${summary.nudges}, возвратов к цели: ${summary.returns}.
${memoryText(memory) || 'Это первая сессия.'}
Если есть прошлые сессии, сравни с ними (лучше или хуже среднего), а совет опирай на повторяющийся паттерн.`,
      },
    ],
    maxTokens: 1500,
  });
  if (text) return text;
  return offlineInsight(summary, memory);
}

// Вывод без ИИ: сравнение со средним, повторяющийся «вор», лучшее время дня.
function offlineInsight(summary, memory) {
  const parts = [];
  const avg = memory && memory.sessions >= 2 ? memory.avgFocus : null;
  if (avg !== null && summary.focusScore >= avg + 5) parts.push(`${summary.focusScore}% фокуса — выше твоего среднего (${avg}%). Растёшь!`);
  else if (avg !== null && summary.focusScore <= avg - 5)
    parts.push(`${summary.focusScore}% фокуса, обычно у тебя ${avg}%. Бывает, завтра отыграемся.`);
  else if (summary.focusScore >= 80) parts.push(`Мощно: ${summary.focusScore}% фокуса.`);
  else parts.push(`Фокус ${summary.focusScore}%.`);
  const worst = summary.topDistractors[0];
  const habitual = worst && memory && memory.topThieves.some((t) => t.label === worst.label);
  if (worst && habitual)
    parts.push(`${worst.label} отвлекает тебя уже не первый раз. Закрой его до старта или добавь в список отвлечений.`);
  else if (worst) parts.push(`Больше всего внимания забрал «${worst.label}». В следующий раз закрой его заранее.`);
  else parts.push('Повтори такой же формат завтра, привычка закрепится.');
  if (memory && memory.bestTime && summary.focusScore < memory.bestTime.avgFocus - 10) {
    const when = { утро: 'утром', день: 'днём', вечер: 'вечером' }[memory.bestTime.name];
    parts.push(`Кстати, лучше всего ты фокусируешься ${when}, попробуй сложное ставить туда.`);
  }
  return parts.join(' ');
}

module.exports = {
  configure,
  chat,
  nudge,
  classifyWindow,
  analyzeScreen,
  reportInsight,
  offlineChat,
  offlineInsight,
  hasAI: () => Boolean(client),
  get MODEL() {
    return MODEL;
  },
};
