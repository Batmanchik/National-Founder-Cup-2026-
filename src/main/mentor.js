// «Мозг» ментора Акыла.
// С ключом ANTHROPIC_API_KEY использует Claude: чат с действиями, оценку окна, анализ скриншота, вывод по сессии.
// Без ключа работает офлайн на шаблонах, поэтому демо не ломается без интернета.
const Anthropic = require('@anthropic-ai/sdk').default;

let MODEL = process.env.NAZAR_MODEL || 'claude-opus-5-5';
// Модели, для которых включаем серверный фолбэк при отказе (refusal).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

let client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
let useFallbacks = FALLBACK_MODELS.has(MODEL);
let customLines = {}; // свои реплики из настроек: { drift: [...], back: [...] }

// Применяет настройки на лету. Ключ из настроек важнее ключа из .env.
function configure({ apiKey, model, lines } = {}) {
  if (model) MODEL = model;
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  client = key ? new Anthropic({ apiKey: key }) : null;
  useFallbacks = FALLBACK_MODELS.has(MODEL);
  customLines = lines || {};
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
      description: 'Для mark_*: короткое слово или сайт из текущего окна, по которому узнавать его в будущем (например «khanacademy» или «Лекция по физике»). Иначе пустая строка',
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

function fmtMin(sec) {
  return sec < 60 ? `${Math.round(sec)} сек` : `${Math.round(sec / 60)} мин`;
}

// «1 минуту», «2 минуты», «5 минут»
function minutesWord(n) {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} минуту`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} минуты`;
  return `${n} минут`;
}

function contextText(ctx) {
  const lines = [`Цель пользователя: «${ctx.goal || 'не задана'}».`];
  if (ctx.live) {
    const l = ctx.live;
    lines.push(
      `Прошло ${fmtMin(l.elapsedSec)} из ${l.plannedMin} мин. Фокус ${l.focusScore}%. ` +
        `По делу ${fmtMin(l.totals.focus)}, отвлечения ${fmtMin(l.totals.distraction)}.` +
        (l.onBreak ? ' Сейчас перерыв.' : ` С прошлого перерыва ${l.focusSinceBreakMin} мин фокуса, заработано ${l.breakEarnedMin} мин отдыха.`)
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
  if (m.topThieves.length) parts.push(`Главные отвлечения за неделю: ${m.topThieves.map((t) => `${t.label} ${fmtMin(t.sec)}`).join(', ')}.`);
  if (m.bestTime) parts.push(`Лучше всего фокус ${m.bestTime.name === 'день' ? 'днём' : m.bestTime.name === 'утро' ? 'утром' : 'вечером'} (${m.bestTime.avgFocus}%).`);
  if (m.last) parts.push(`Прошлая сессия: «${m.last.goal}», фокус ${m.last.focusScore}%.`);
  return parts.join(' ');
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Мгновенные реплики (шаблоны), чтобы реакция была без задержки.
// Реплики: напористо, как тренер («давай-давай, работай-работай!»), но без спортивных метафор. Мат только запиканный.
const LINES = {
  greet: ['Салем! Я Акыл. Над чем работаем?', 'Привет! Я Акыл. Говори цель — и погнали, работай-работай!'],
  start: ['Погнали! Цель: «{goal}». Давай-давай, работаем!', 'Окей, «{goal}». Телефон подальше — и работай-работай!', 'Так, собрались! «{goal}», темп, темп!'],
  drift: ['Эй! «{goal}» ждёт, давай-давай!', 'Стоп-стоп, это {label}! Возвращаемся, работай-работай!', 'Я всё вижу 👀 Сейчас {label}, а цель — «{goal}»! Давай!'],
  driftRepeat: ['Уже {n}-й раз {label}! Ну-ка закрыл и работаем, работаем!', '{n}-й раз {label}?! Закрывай его совсем и давай-давай!'],
  driftHabit: ['{label} — твой главный вор на этой неделе! Не отдаём ему ни минуты, давай!', 'Снова {label}! За неделю он уже забрал {weekMin}. Хватит, работай-работай!'],
  startMemory: ['Подсказка: на этой неделе {label} забрал {weekMin}. Закрой его заранее!', 'За неделю {label} съел {weekMin}. Убери его подальше — и погнали!'],
  startLast: ['В прошлый раз больше всего отвлекал {label}. Закрой его заранее!'],
  // Блокировка выключения
  blockFirst: [
    'Ах ты ж #@$%! 🤬 Выключить меня решил?! Не выйдет! 🔒 Ещё {left}, давай-давай!',
    'Э-э-э, куда, *пи-и-ип*?! Ещё {left} «{goal}», работай-работай!',
    '🤬 Ну ты и %#@&! Я никуда не ухожу! Ещё {left}.',
  ],
  blockAgain: [
    'Опять?! Да ну #@$%&! Сначала «{goal}», потом свобода! Работай-работай!',
    '*пи-и-ип* *пи-и-ип*! 🤬 Второй раз! Ещё {left}, темп, темп!',
    'Ты серьёзно, $#@!? Я сказал: ещё {left}! Давай-давай!',
  ],
  blockMany: [
    'ХАЛТУРЩИК! 🤬 #@$%&*! Это уже {n}-я попытка! Всё запишу в чек!',
    '{n}-я попытка?! Да чтоб тебя *пи-и-и-ип*! Хочешь сдаться — скажи «я сдаюсь».',
    'Э, т#@%&*$с, э! Уже {n}-я попытка! Хорош халтурить, давай-давай, работай-работай! Ещё {left}.',
    '🤬🤬🤬 #$@%! Цензура не успевает запикивать! Ещё {left} — и свободен.',
  ],
  killed: [
    'Через диспетчер задач меня вырубил?! #@$%&! 🤬 Не прокатит: «{goal}» продолжается, ещё {left}!',
    'Я ВЕРНУЛСЯ, *пи-и-ип*! Убить меня — не значит закончить «{goal}». Ещё {left}, работай-работай!',
  ],
  resumed: ['С возвращением! Продолжаем «{goal}», ещё {left}. Давай-давай!'],
  endEarly: [
    'Рано, %#@&! Ещё {left}! Если правда всё сделал — напиши «я сдаюсь».',
    'Стоп-стоп, *пи-и-ип*! Ещё {left}, добиваем! Сдаёшься? Напиши «я сдаюсь».',
  ],
  surrender: ['Эх… Засчитываю досрочный финиш. В чеке будет отметка, опыта — половина.', 'Ладно, сдался — твоё право. Но в следующий раз дотянем до конца!'],
  unlocked: ['Время вышло — блокировка снята. Вот это выдержка, красава! 🔓'],
  marked: ['Понял, запомнил: «{keyword}» — это работа. Больше не дёргаю.', 'Окей, «{keyword}» теперь в списке работы.'],
  markedDistraction: ['Запомнил: «{keyword}» — отвлечение. Буду следить!', 'Окей, «{keyword}» теперь в списке отвлечений.'],
  driftLong: ['Уже пару минут в «{label}»! Если заработал отдых — скажи «дай перерыв». Иначе работай-работай!', 'Тебя затянуло! Либо честный перерыв, либо назад к «{goal}». Давай-давай!'],
  back: ['Красава! 💪 Работай-работай!', 'Вернулся — красава! +5 XP!', 'Вот это темп! Так держать, давай-давай!'],
  // Перерывы зарабатываются фокусом: ~1 мин отдыха на 5 мин работы (см. session.js)
  breakOk: ['Заслужил! {work} по делу — отдыхаем {m}. Потом обратно к «{goal}».', 'Окей, {m} отдыха — за {work} фокуса честно. Встань, потянись, водички попей!'],
  breakCut: ['Ты в фокусе {work} — это {m} отдыха, не {asked}. Держи {m}, потом давай-давай!', 'Не-не, за {work} работы положено {m}, а не {asked}. Даю {m}!'],
  breakEarly: ['Рано отдыхать! Ты в фокусе всего {work}. Ещё минут {need} — и заработаешь перерыв.', 'Перерыв ещё не заработан: {work} по делу. Поработай-ка ещё {need} мин, давай-давай!'],
  breakDue: ['Ты уже {work} в фокусе, красава! Мозгу нужен отдых: заслужил {m} перерыва.', '{work} без отрыва — мощно! Самое время для перерыва на {m}, потом продуктивнее пойдёт.'],
  breakOver: ['Перерыв всё! «{goal}» ждёт, давай-давай!', 'Подъём! Водички попил — и работай-работай!'],
  timeUp: ['Время вышло! Завершим и посмотрим чек внимания?', 'Таймер всё, красава! Заканчиваем или ещё 15 минут?'],
};

function line(kind, vars = {}) {
  const own = customLines[kind];
  return pick(own && own.length ? own : LINES[kind] || ['…']).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Реплика при отвлечении с учётом того, сколько раз это уже было и что Акыл помнит о неделе.
function driftLine({ goal, label, nudges = 1, memory = null }) {
  if (customLines.drift && customLines.drift.length) return line('drift', { goal, label }); // свои фразы пользователя важнее
  const thief = memory && memory.topThieves.find((t) => t.label === label);
  if (thief && thief.sec >= 300 && memory.topThieves[0].label === label && Math.random() < 0.6)
    return line('driftHabit', { goal, label, weekMin: fmtMin(thief.sec) });
  if (nudges >= 3) return line('driftRepeat', { goal, label, n: nudges });
  return line('drift', { goal, label });
}

// Приветствие при старте: цель плюс совет из прошлых сессий.
function startLine(goal, memory) {
  const first = line('start', { goal });
  if (!memory) return first;
  const thief = memory.topThieves[0];
  if (thief && thief.sec >= 120) return `${first} ${line('startMemory', { label: thief.label, weekMin: fmtMin(thief.sec) })}`;
  if (memory.last && memory.last.topDistractor) return `${first} ${line('startLast', { label: memory.last.topDistractor })}`;
  return first;
}

const TIPS = [
  'Положи телефон в другую комнату, не просто экраном вниз.',
  'Начни с самого маленького шага: открой файл и напиши одно предложение.',
  'Закрой все вкладки, которые не нужны для цели. Прямо сейчас.',
  'Работай 25 минут, потом честный перерыв на 5. Я засеку.',
  'Сформулируй, что будет готово к концу сессии. Конкретно.',
];

// Офлайн-чат: понимает базовые просьбы по ключевым словам.
function offlineChat(text, ctx) {
  const t = text.toLowerCase();
  const num = Number((t.match(/\d+/) || [])[0]) || 0;
  const limit = (v, lo, hi) => Math.min(hi, Math.max(lo, v)); // те же пределы, что в session.js
  if (/перерыв|отдох|устал|демалыс/.test(t)) {
    // Сколько дать — решает сессия по заработанному фокусу; здесь только запоминаем, сколько попросили (0 = сколько заслужил).
    return { reply: '', action: 'break', minutes: limit(num, 0, 60) };
  }
  // Поправки: «это по работе», «это не отвлечение», «это тоже отвлечение».
  if (/не\s+отвлеч|по\s+работе|по\s+делу|для\s+(учёбы|учебы|работы|курсов|проекта)|это\s+(лекция|урок|нужно)|жұмыс/.test(t))
    return { reply: '', action: 'mark_focus', minutes: 0, keyword: '' };
  if (/(это|тоже|запомни).{0,15}отвлеч/.test(t)) return { reply: '', action: 'mark_distraction', minutes: 0, keyword: '' };
  const negated = /(^|\s)не\s+(всё\s+)?(законч|сделал|готов)/.test(t);
  if (!negated && /законч|готово|сделал|(^|\s)всё[.!]*$|бітті/.test(t)) return { reply: 'Отлично! Сейчас покажу твой чек внимания.', action: 'end_session', minutes: 0 };
  if (/продл|ещё|еще|больше времени/.test(t)) {
    const m = limit(num || 15, 5, 60);
    return { reply: `Добавил ${minutesWord(m)}. Держим темп!`, action: 'extend', minutes: m };
  }
  if (/осталось|сколько времени|таймер/.test(t) && ctx.live) {
    return { reply: `Осталось ${fmtMin(ctx.live.remainingSec)}. Фокус пока ${ctx.live.focusScore}%.`, action: 'none', minutes: 0 };
  }
  if (/как я|статист|сколько/.test(t) && ctx.live) {
    const l = ctx.live;
    const m = ctx.memory;
    const cmp = m && m.sessions >= 2 ? (l.focusScore >= m.avgFocus ? ` Это выше твоего среднего (${m.avgFocus}%) 🔥` : ` Твой средний ${m.avgFocus}%, догоняем.`) : '';
    return { reply: `Фокус ${l.focusScore}%: по делу ${fmtMin(l.totals.focus)}, отвлечения ${fmtMin(l.totals.distraction)}.${cmp}`, action: 'none', minutes: 0 };
  }
  if (/совет|помоги|не могу|лень|скучно|не получается|мотивац/.test(t)) {
    const m = ctx.memory;
    if (m && m.topThieves[0] && Math.random() < 0.5)
      return { reply: `Главный вор этой недели — ${m.topThieves[0].label}. Закрой его и возвращайся к «${ctx.goal}».`, action: 'none', minutes: 0 };
    return { reply: pick(TIPS), action: 'none', minutes: 0 };
  }
  if (/что умеешь|помощь|help|команды/.test(t)) {
    return { reply: 'Могу: «дай перерыв» (сколько заслужил), «продли на 15», «как я?», «сколько осталось», «это по работе», «я закончил».', action: 'none', minutes: 0 };
  }
  if (/привет|салем|сәлем|hi\b|hello/.test(t)) return { reply: `Салем! Держим курс на «${ctx.goal}».`, action: 'none', minutes: 0 };
  return { reply: `Я офлайн-версия, но слежу за целью «${ctx.goal}». Напиши «что умеешь» или добавь ключ Claude — стану умнее.`, action: 'none', minutes: 0 };
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
  else if (avg !== null && summary.focusScore <= avg - 5) parts.push(`${summary.focusScore}% фокуса, обычно у тебя ${avg}%. Бывает, завтра отыграемся.`);
  else if (summary.focusScore >= 80) parts.push(`Мощно: ${summary.focusScore}% фокуса.`);
  else parts.push(`Фокус ${summary.focusScore}%.`);
  const worst = summary.topDistractors[0];
  const habitual = worst && memory && memory.topThieves.some((t) => t.label === worst.label);
  if (worst && habitual) parts.push(`${worst.label} отвлекает тебя уже не первый раз. Закрой его до старта или добавь в список отвлечений.`);
  else if (worst) parts.push(`Больше всего внимания забрал «${worst.label}». В следующий раз закрой его заранее.`);
  else parts.push('Повтори такой же формат завтра, привычка закрепится.');
  if (memory && memory.bestTime && summary.focusScore < memory.bestTime.avgFocus - 10) {
    const when = { утро: 'утром', день: 'днём', вечер: 'вечером' }[memory.bestTime.name];
    parts.push(`Кстати, лучше всего ты фокусируешься ${when}, попробуй сложное ставить туда.`);
  }
  return parts.join(' ');
}

// Реплика на попытку выключить Акыла во время заблокированной сессии: чем больше попыток, тем злее.
function blockLine({ n, goal, leftSec }) {
  const vars = { n, goal, left: fmtMin(leftSec) };
  return line(n <= 1 ? 'blockFirst' : n === 2 ? 'blockAgain' : 'blockMany', vars);
}

module.exports = {
  minutesWord,
  chat,
  blockLine,
  fmtMin,
  nudge,
  driftLine,
  startLine,
  offlineChat,
  offlineInsight,
  classifyWindow,
  analyzeScreen,
  reportInsight,
  line,
  configure,
  hasAI: () => Boolean(client),
  get MODEL() {
    return MODEL;
  },
};
