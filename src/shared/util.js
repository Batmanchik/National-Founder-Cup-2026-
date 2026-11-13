// Мелкие общие функции. Работают и в Node (main-процесс, тесты), и в браузере (renderer, глобальный NazarUtil).
// Всё, что нужно больше чем в одном месте, живёт здесь, а не копируется по файлам.
(function (root) {
  'use strict';

  /** Целое число в границах [lo, hi]; мусор на входе превращается в fallback (по умолчанию lo). */
  function clamp(value, lo, hi, fallback = lo) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  }

  /** Случайный элемент массива. */
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /** Русское множественное число: plural(5, 'минута', 'минуты', 'минут') → 'минут'. */
  function plural(n, one, few, many) {
    const d = Math.abs(n) % 10;
    const dd = Math.abs(n) % 100;
    if (d === 1 && dd !== 11) return one;
    if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
    return many;
  }

  /** «3 минуты» (как в «прошло 3 минуты») и «1 минуту» (как в «дай 1 минуту»). */
  const minutes = (n) => `${n} ${plural(n, 'минута', 'минуты', 'минут')}`;
  const minutesAcc = (n) => `${n} ${plural(n, 'минуту', 'минуты', 'минут')}`;
  /** «1 раз», «2 раза», «5 раз». */
  const times = (n) => `${n} ${plural(n, 'раз', 'раза', 'раз')}`;

  /** Короткая длительность: «40 сек» или «12 мин». */
  const fmtMin = (sec) => (sec < 60 ? `${Math.round(sec)} сек` : `${Math.round(sec / 60)} мин`);

  /** Сумма в тенге: «≈ 4,6 ₸» для мелочи, «≈ 1 250 ₸» с пробелами между тысячами. */
  function fmtTenge(tenge) {
    const t = Number(tenge) || 0;
    if (t < 0.05) return '0 ₸';
    const text = t < 10 ? t.toFixed(1).replace('.', ',') : String(Math.round(t)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `≈ ${text} ₸`;
  }

  /** Таймер «мм:сс». */
  const fmtClock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  /** '#ffd166' → [255, 209, 102]. */
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Подставляет {ключи} в шаблон: fill('Цель «{goal}»', { goal: 'код' }). */
  const fill = (template, vars = {}) => template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

  const api = { clamp, pick, plural, minutes, minutesAcc, times, fmtMin, fmtClock, fmtTenge, hexToRgb, fill };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NazarUtil = api;
})(typeof self !== 'undefined' ? self : this);
