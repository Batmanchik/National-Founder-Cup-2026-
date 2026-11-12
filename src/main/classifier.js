// Быстрая классификация активного окна по правилам (без ИИ, работает офлайн).
// Возвращает { category: 'focus' | 'distraction' | 'neutral', label, reason, soft }
// soft = true значит «правила не уверены» — такое окно дополнительно оценивает ИИ (mentor.classifyWindow).

const DISTRACTION = [
  { re: /reels|shorts|tiktok|тикток|рилс/i, label: 'Короткие видео' },
  { re: /instagram|инстаграм/i, label: 'Instagram' },
  { re: /facebook|\bvk\.com|вконтакте|twitter|(?<![\w.])x\.com|threads\.(?:net|com)|[•|]\s*threads\b/i, label: 'Соцсети' },
  { re: /netflix|kinopoisk|кинопоиск|ivi\.ru|rezka|аниме|anime|сериал/i, label: 'Сериалы' },
  { re: /twitch|kick\.com/i, label: 'Стримы' },
  { re: /steam|epic games|roblox|minecraft|dota|cs2|valorant|genshin|league of legends|brawl stars/i, label: 'Игры' },
  { re: /pinterest|9gag|reddit|pikabu|пикабу/i, label: 'Лента' },
];

const FOCUS = [
  { re: /visual studio|vs ?code|\bcode\b|cursor|intellij|pycharm|webstorm|android studio|xcode|sublime|\bvim\b|terminal|iterm|powershell|cmd\.exe|windowsterminal|konsole/i, label: 'Код' },
  { re: /figma|canva|photoshop|illustrator|blender/i, label: 'Дизайн' },
  { re: /\bword\b|winword|excel|powerpnt|powerpoint|google docs|документы google|google sheets|таблицы google|google slides|презентации google|notion|obsidian|onenote|keynote|libreoffice/i, label: 'Документы' },
  { re: /github|gitlab|stack ?overflow|developer\.mozilla|documentation|leetcode|codeforces/i, label: 'Разработка' },
  { re: /zoom|microsoft teams|google meet|meet\.google/i, label: 'Созвон' },
  { re: /chatgpt|claude|gemini|perplexity/i, label: 'ИИ-ассистент' },
  { re: /coursera|stepik|khan ?academy|udemy|duolingo|bilimland|opiq|kundelik|moodle/i, label: 'Учёба' },
];

const SOFT = [
  { re: /youtube/i, label: 'YouTube' },
  { re: /telegram|whatsapp|discord|slack/i, label: 'Мессенджеры' },
];

const SELF = /electron|nazar/i;

// Общие слова цели («сделать», «написать», «работа») не говорят о содержании окна и дают ложный фокус.
const GOAL_STOP = new Set(
  [
    'сделать', 'доделать', 'написать', 'дописать', 'закончить', 'начать', 'подготовить', 'подготовиться',
    'прочитать', 'дочитать', 'выучить', 'учить', 'изучить', 'повторить', 'решить', 'работа', 'работать',
    'поработать', 'задача', 'задачи', 'задание', 'минут', 'минуты', 'часов', 'сегодня', 'завтра', 'нужно',
    'надо', 'хочу', 'своей', 'свою', 'свой', 'новый', 'новую', 'немного', 'finish', 'write', 'make', 'work',
    'study', 'learn', 'read', 'start', 'with', 'this', 'that', 'today',
  ].map((w) => w.slice(0, Math.max(4, w.length - 2)))
);

// Слова из цели (≥4 букв), обрезанные до основы, чтобы «курсовая» совпала с «курсовую».
function goalStems(goal) {
  return String(goal || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, Math.max(4, w.length - 2)))
    .filter((stem) => !GOAL_STOP.has(stem));
}

// custom: { focus: [...], distract: [...] } — свои слова и сайты из настроек, важнее встроенных правил.
function classify(win, goal, custom = {}) {
  const app = (win && win.app) || '';
  const title = (win && win.title) || '';
  const url = (win && win.url) || '';
  const text = `${app} ${title} ${url}`;

  if (!app && !title) return { category: 'neutral', label: 'Неизвестно', reason: 'нет данных об окне', soft: false };
  if (SELF.test(app)) return { category: 'neutral', label: 'Nazar', reason: 'сам Nazar', soft: false };

  const hay = text.toLowerCase();
  const hit = (list) => (list || []).find((word) => word && hay.includes(String(word).toLowerCase()));
  // Свои списки пользователя важнее всего остального.
  const myFocus = hit(custom.focus);
  if (myFocus) return { category: 'focus', label: myFocus, reason: 'мой список работы', soft: false };
  const myDistract = hit(custom.distract);
  if (myDistract) return { category: 'distraction', label: myDistract, reason: 'мой список отвлечений', soft: false };

  const lowered = `${title} ${url}`.toLowerCase();
  const stem = goalStems(goal).find((s) => lowered.includes(s));
  if (stem) {
    // Цель «пост для Instagram» не должна превращать всю ленту Instagram в фокус: такое окно решает ИИ.
    const clash = DISTRACTION.find((rule) => rule.re.test(text));
    if (clash) return { category: 'neutral', label: clash.label, reason: `похоже и на цель («${stem}»), и на отвлечение`, soft: true };
    return { category: 'focus', label: 'По цели', reason: `в заголовке есть «${stem}»`, soft: false };
  }

  for (const rule of DISTRACTION) {
    if (rule.re.test(text)) return { category: 'distraction', label: rule.label, reason: 'список отвлечений', soft: false };
  }
  for (const rule of FOCUS) {
    if (rule.re.test(text)) return { category: 'focus', label: rule.label, reason: 'рабочее приложение', soft: false };
  }
  for (const rule of SOFT) {
    if (rule.re.test(text)) return { category: 'neutral', label: rule.label, reason: 'зависит от контекста', soft: true };
  }
  return { category: 'neutral', label: app || 'Другое', reason: 'нет правила', soft: true };
}

module.exports = { classify, goalStems };
