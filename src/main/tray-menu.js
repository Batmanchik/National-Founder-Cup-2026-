// Меню иконки в трее. Чистая функция: состояние + действия → шаблон для Menu.buildFromTemplate.
// Без Electron, поэтому её легко проверить тестом.

/**
 * @param {{ mentorOn: boolean, locked: boolean, goal: string|null, vision: boolean, ai: boolean }} st
 * @param {Record<string, Function>} act
 */
function trayMenuTemplate(st, act) {
  const { mentorOn: on, locked: lock } = st;
  return [
    { label: 'Открыть Nazar', click: act.openPanel },
    { label: lock ? '🔒 Выключить Акыла (заблокировано)' : on ? 'Выключить Акыла' : 'Включить Акыла', click: act.toggleMentor },
    { type: 'separator' },
    { label: st.goal ? `🎯 ${st.goal}` : 'Нет активной сессии', enabled: false },
    { label: 'Новая сессия…', enabled: on && !lock, click: act.newSession },
    {
      label: lock ? '🔒 Завершить сессию (только после таймера)' : 'Завершить сессию и показать чек',
      enabled: Boolean(st.goal),
      click: act.endSession,
    },
    ...(lock ? [{ label: '🏳 Сдаться досрочно…', click: act.openPanel }] : []),
    { label: 'Чат с Акылом  (Ctrl+Shift+Space)', enabled: on, click: act.openChat },
    { type: 'separator' },
    {
      label: 'Зрение: анализ экрана ИИ',
      type: 'checkbox',
      checked: st.vision,
      enabled: st.ai,
      click: (item) => act.setVision(item.checked),
    },
    { label: 'Демо: отвлечение на Reels  (Ctrl+Shift+9)', enabled: on, click: act.demoDistract },
    { label: 'Демо: работа в VS Code  (Ctrl+Shift+0)', enabled: on, click: act.demoWork },
    { type: 'separator' },
    { label: lock ? '🔒 Выход (после сессии)' : 'Выход', click: act.quit },
  ];
}

module.exports = { trayMenuTemplate };
