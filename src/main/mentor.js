// «Мозг» ментора Акыла.
// С ключом ANTHROPIC_API_KEY использует Claude: чат с действиями, оценку окна, анализ скриншота, вывод по сессии.
// Без ключа работает офлайн на шаблонах, поэтому демо не ломается без интернета.
const Anthropic = require('@anthropic-ai/sdk').default;

const MODEL = process.env.NAZAR_MODEL || 'claude-opus-5-5';
// Модели, для которых включаем серверный фолбэк при отказе (refusal).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
let useFallbacks = FALLBACK_MODELS.has(MODEL);

const PERSONA = `Ты — Акыл, маленький пиксельный ментор приложения Nazar. Ты живёшь внизу экрана ноутбука пользователя.
Твоя задача: помочь человеку удержать цель, которую он сам назвал, и честно показывать, куда уходит его внимание.
Характер: дружелюбный, с лёгким юмором, как старший друг-студент. Не читаешь нотаций, не стыдишь, не морализируешь.
Пиши очень коротко: 1–2 предложения, максимум 25 слов. Отвечай на языке пользователя (русский или казахский).
Никогда не выдумывай, что видел на экране, если этого нет в контексте.`;

const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Реплика Акыла пользователю' },
    action: {
      type: 'string',
      enum: ['none', 'break', 'end_session', 'extend'],
      description: 'break — дать перерыв; end_session — человек закончил; extend — продлить сессию',
    },
    minutes: { type: 'integer', description: 'Минуты для break (1–15) или extend (5–60), иначе 0' },
  },
  required: ['reply', 'action', 'minutes'],
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

function fmtMin(sec) {
  return `${Math.round(sec / 60)} мин`;
}

function contextText(ctx) {
  const lines = [`Цель пользователя: «${ctx.goal || 'не задана'}».`];
  if (ctx.live) {
    const l = ctx.live;
    lines.push(
      `Прошло ${fmtMin(l.elapsedSec)} из ${l.plannedMin} мин. Фокус ${l.focusScore}%. ` +
        `По делу ${fmtMin(l.totals.focus)}, отвлечения ${fmtMin(l.totals.distraction)}.` +
        (l.onBreak ? ' Сейчас перерыв.' : '')
    );
  }
  if (ctx.window && (ctx.window.app || ctx.window.title)) {
    lines.push(`Сейчас открыто: ${ctx.window.app} — «${ctx.window.title}»${ctx.window.url ? ` (${ctx.window.url})` : ''}.`);
  }
  if (ctx.vision && ctx.vision.activity) lines.push(`По последнему скриншоту: ${ctx.vision.activity}.`);
  return lines.join('\n');
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Мгновенные реплики (шаблоны), чтобы реакция была без задержки.
const LINES = {
  greet: ['Привет! Я Акыл, твой пиксельный ментор. Над чем работаем?', 'Салем! Я Акыл. Скажи цель — и я прослежу, чтобы лента её не украла.'],
  start: ['Погнали! Цель: «{goal}». Я рядом.', 'Окей, «{goal}». Телефон подальше, я на страже.'],
  drift: ['Эй, мы же пришли за «{goal}». Вернёмся?', 'Стоп-стоп, это {label}. А цель была «{goal}».', 'Я всё вижу 👀 {label} подождёт, «{goal}» — нет.'],
  driftLong: ['Уже пару минут в «{label}». Может, честный перерыв на 5 минут, а потом обратно?', 'Похоже, лента затянула. Скажи «дай перерыв» — или вернёмся к «{goal}».'],
  back: ['Красава! Снова в деле 💪', 'Вернулся — это главное. +5 XP!', 'Вот это фокус. Продолжаем!'],
  breakOver: ['Перерыв закончился. Возвращаемся к «{goal}»?', 'Подъём! Перерыв всё, «{goal}» ждёт.'],
  timeUp: ['Время вышло! Завершим и посмотрим чек внимания?', 'Таймер всё. Закончим или продлим?'],
};

function line(kind, vars = {}) {
  return pick(LINES[kind] || ['…']).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Офлайн-чат: понимает базовые просьбы по ключевым словам.
function offlineChat(text, ctx) {
  const t = text.toLowerCase();
  const num = Number((t.match(/\d+/) || [])[0]) || 0;
  if (/перерыв|отдох|устал|демалыс/.test(t)) return { reply: `Окей, ${num || 5} минут отдыха. Потом обратно к «${ctx.goal}».`, action: 'break', minutes: num || 5 };
  if (/законч|готово|сделал|всё|бітті/.test(t)) return { reply: 'Отлично! Сейчас покажу твой чек внимания.', action: 'end_session', minutes: 0 };
  if (/продл|ещё|еще|больше времени/.test(t)) return { reply: `Добавил ${num || 15} минут. Держим темп!`, action: 'extend', minutes: num || 15 };
  if (/как я|статист|сколько/.test(t) && ctx.live) {
    const l = ctx.live;
    return { reply: `Фокус ${l.focusScore}%: по делу ${fmtMin(l.totals.focus)}, отвлечения ${fmtMin(l.totals.distraction)}.`, action: 'none', minutes: 0 };
  }
  return { reply: `Я офлайн-версия, но слежу за целью «${ctx.goal}». Добавь ключ Claude — стану умнее.`, action: 'none', minutes: 0 };
}

async function chat(history, text, ctx) {
  const messages = [
    ...history.slice(-10),
    { role: 'user', content: `[Контекст]\n${contextText(ctx)}\n\n[Сообщение пользователя]\n${text}` },
  ];
  const system = `${PERSONA}
Ты можешь выполнить действие: дать перерыв (action=break, 1–15 минут, если человек устал или просит), завершить сессию (end_session, если человек говорит, что закончил), продлить сессию (extend, 5–60 минут). В остальных случаях action=none и minutes=0.
Если человек просит отвлечься без причины — можно договориться о коротком перерыве, но напомни про цель.`;
  const res = await callClaude({ system, messages, schema: CHAT_SCHEMA });
  if (res && typeof res.reply === 'string') return { ...res, ai: true };
  return { ...offlineChat(text, ctx), ai: false };
}

// ИИ решает, связано ли «непонятное» окно (YouTube, мессенджер, сайт) с целью.
async function classifyWindow(goal, win) {
  const res = await callClaude({
    system: 'Ты классифицируешь активное окно пользователя относительно его цели. focus — помогает цели; distraction — развлечение не по теме; neutral — служебное или коротко нужное.',
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
async function reportInsight(summary) {
  const top = summary.topDistractors.map((d) => `${d.label} (${fmtMin(d.sec)})`).join(', ') || 'нет';
  const text = await callClaude({
    system: `${PERSONA}\nСейчас ты подводишь итог фокус-сессии. 2–3 коротких предложения: что получилось, где утекло внимание, один конкретный совет на следующий раз.`,
    messages: [
      {
        role: 'user',
        content: `Цель: «${summary.goal}». Длительность ${summary.elapsedMin} мин (план ${summary.plannedMin}). Фокус ${summary.focusScore}%.
По делу ${fmtMin(summary.totals.focus)}, отвлечения ${fmtMin(summary.totals.distraction)}, нейтрально ${fmtMin(summary.totals.neutral)}, перерывы ${fmtMin(summary.totals.break)}.
Главные отвлечения: ${top}. Напоминаний: ${summary.nudges}, возвратов к цели: ${summary.returns}.`,
      },
    ],
    maxTokens: 1500,
  });
  if (text) return text;
  if (summary.focusScore >= 80) return `Мощно: ${summary.focusScore}% фокуса. Повтори такой же формат завтра — привычка закрепится.`;
  const worst = summary.topDistractors[0];
  return `Фокус ${summary.focusScore}%. ${worst ? `Больше всего внимания забрал «${worst.label}». В следующий раз закрой его до старта.` : 'Попробуй сессию покороче — 25 минут.'}`;
}

module.exports = { chat, classifyWindow, analyzeScreen, reportInsight, line, hasAI: () => Boolean(client), MODEL };
