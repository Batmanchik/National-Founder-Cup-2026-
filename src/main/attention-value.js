// «Счёт за внимание»: сколько рекламных денег принесло платформам время, которое человек провёл в ленте.
// Чистая логика без Electron — покрыта тестами в test/attention-value.test.js.
//
// Метод: рекламный доход платформы за 2025 год ÷ суммарные часы её пользователей = доход за час внимания.
// Это средние мировые оценки по публичным данным, а не точный счёт конкретного человека:
// в Казахстане рекламодатели платят за пользователя меньше среднего по миру, поэтому в интерфейсе везде стоит «≈».
// Там, где источники расходятся, взято значение, которое даёт МЕНЬШУЮ сумму.
//
//  • YouTube: $40,4 млрд рекламы (WARC), ~2,6 млрд пользователей × 58 мин/день → ≈ $0,044/час
//  • TikTok и короткие видео: ~$33 млрд рекламы, ~1,6 млрд × 58 мин/день → ≈ $0,06/час
//  • Instagram (Meta): $57,03 в год с активного человека (ARPP 2025) ÷ 73 мин/день → ≈ $0,13/час
//  • Прочие соцсети, ленты и стримы: по нижней из оценок выше
//  • Сериалы и игры не считаем: они зарабатывают подпиской и покупками, а не продажей внимания.
const USD_TO_KZT = 450; // курс Нацбанка РК на ноябрь 2026, округлённо
const WEEKS_PER_YEAR = 52;

/** Доход платформы за час внимания, USD. Порядок важен: первое совпадение по названию категории. */
const RATES = [
  { re: /instagram|инстаграм/i, usdPerHour: 0.13, source: 'Meta, ARPP 2025' },
  { re: /коротк|reels|shorts|tiktok|тикток/i, usdPerHour: 0.06, source: 'TikTok, реклама 2025' },
  { re: /youtube|ютуб/i, usdPerHour: 0.044, source: 'YouTube, реклама 2025' },
  { re: /соцсет|лента|стрим/i, usdPerHour: 0.044, source: 'нижняя оценка' },
];

function rateFor(label) {
  const hit = RATES.find((r) => r.re.test(String(label || '')));
  return hit ? hit.usdPerHour : 0;
}

/**
 * @param {Record<string, number> | Array<{ label: string, sec: number }>} distractors секунды по категориям отвлечений
 * @returns {{ tenge: number, countedSec: number, top: { label: string, tenge: number } | null }}
 */
function adValue(distractors) {
  const list = Array.isArray(distractors) ? distractors : Object.entries(distractors || {}).map(([label, sec]) => ({ label, sec }));
  let tenge = 0;
  let countedSec = 0;
  let top = null;
  for (const { label, sec } of list) {
    const rate = rateFor(label);
    if (!rate || !sec) continue;
    const value = (sec / 3600) * rate * USD_TO_KZT;
    tenge += value;
    countedSec += sec;
    if (!top || value > top.tenge) top = { label, tenge: value };
  }
  return { tenge, countedSec, top };
}

/** Сумма за последние 7 дней по истории сессий и прогноз на год в том же темпе. */
function weeklyAdValue(sessions, now = Date.now()) {
  const weekAgo = now - 7 * 86400000;
  const week = sessions
    .filter((s) => s.endedAt >= weekAgo)
    .reduce((sum, s) => sum + (typeof s.adValue === 'number' ? s.adValue : adValue(s.topDistractors).tenge), 0);
  return { week, year: week * WEEKS_PER_YEAR };
}

module.exports = { adValue, weeklyAdValue, rateFor, RATES, USD_TO_KZT };
