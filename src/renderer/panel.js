// Окно управления: включение и выключение Акыла, настройки без правки файлов.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.nazarPanel;
  const S = NazarSprites;

  const NUMBERS = ['driftSec', 'visionIntervalSec'];
  const CHECKS = ['startMentorOnOpen', 'autoStart', 'vision', 'strictMode', 'speak'];
  const LISTS = ['focusSites', 'distractSites', 'driftLines', 'backLines'];

  let dirty = false;
  let clearKey = false;
  let savedTimer = null;

  function drawAkyl(on) {
    const cv = $('akyl');
    cv.width = S.WIDTH;
    cv.height = S.HEIGHT;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, S.WIDTH, S.HEIGHT);
    S.frame(on ? { mouth: 'smile', eyes: 'happy', arms: 'wave' } : { eyes: 'blink' }).forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const color = S.PALETTE[ch];
        if (!color) return;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      });
    });
  }

  function renderStatus(st) {
    drawAkyl(st.mentorOn);
    $('status').textContent = !st.mentorOn
      ? 'Акыл выключен'
      : st.goal
        ? `Акыл работает. Цель: «${st.goal}»`
        : 'Акыл работает. Нажми на него внизу экрана, чтобы начать сессию';
    const btn = $('toggle');
    const left = Math.ceil(st.lockLeftSec / 60);
    btn.textContent = st.locked ? `🔒 ещё ${left} мин` : st.mentorOn ? 'Выключить Акыла' : 'Включить Акыла';
    btn.className = `big ${st.locked ? 'locked' : st.mentorOn ? 'off' : 'on'}`;
    btn.title = st.locked ? 'Блокировка: Акыл не выключится до конца сессии' : '';
    $('lock-box').hidden = !st.locked;
    if (st.locked) {
      $('status').textContent = `🔒 Сессия «${st.goal}» заблокирована ещё на ${left} мин.`;
      $('lock-text').textContent =
        `Акыла не выключить до конца таймера.${st.attempts ? ` Попыток выключить: ${st.attempts}.` : ''} ` +
        'Если правда надо уйти — сдайся. В чеке будет отметка, опыта — половина.';
    }
    $('clear-key').hidden = !st.settings.hasKey || clearKey;
    $('apiKey').placeholder = st.settings.hasKey ? 'Ключ сохранён. Впиши новый, чтобы заменить' : 'sk-ant-…';
    $('apiKey').disabled = !st.canEncrypt;
    $('ai-state').textContent = st.ai
      ? 'ИИ подключён.'
      : 'Сейчас работает офлайн-режим: Акыл понимает простые команды и использует шаблоны.';
    const autoRow = $('autoStart').closest('label');
    $('autoStart').disabled = !st.canAutostart;
    autoRow.classList.toggle('off', !st.canAutostart);
    autoRow.title = st.canAutostart ? '' : 'Доступно в установленной версии (Nazar-Setup.exe)';
  }

  function fillForm(st) {
    const s = st.settings;
    NUMBERS.forEach((k) => ($(k).value = s[k]));
    CHECKS.forEach((k) => ($(k).checked = s[k]));
    LISTS.forEach((k) => ($(k).value = s[k].join('\n')));
    $('model').value = s.model;
    $('buddySize').value = s.buddySize;
    $('apiKey').value = '';
    clearKey = false;
    dirty = false;
  }

  function readForm() {
    const patch = { buddySize: $('buddySize').value, model: $('model').value, apiKey: $('apiKey').value, clearKey };
    NUMBERS.forEach((k) => (patch[k] = $(k).value));
    CHECKS.forEach((k) => (patch[k] = $(k).checked));
    LISTS.forEach((k) => (patch[k] = $(k).value));
    return patch;
  }

  function flash(text, isError) {
    clearTimeout(savedTimer);
    const el = $('saved');
    el.textContent = text;
    el.className = isError ? 'err' : '';
    if (!isError) savedTimer = setTimeout(() => (el.textContent = ''), 2500);
  }

  async function save() {
    const res = await api.save(readForm());
    if (!res.ok) return flash(res.error, true);
    fillForm(res.state);
    renderStatus(res.state);
    flash('Сохранено');
  }

  $('form').addEventListener('input', () => (dirty = true));
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });
  $('save').addEventListener('click', save);
  $('toggle').addEventListener('click', async () => {
    $('toggle').disabled = true;
    renderStatus(await api.toggle());
    $('toggle').disabled = false;
  });
  $('surrender').addEventListener('click', async () => {
    const res = await api.surrender($('surrender-phrase').value);
    $('lock-err').textContent = res.ok ? '' : res.error;
    if (res.ok) $('surrender-phrase').value = '';
    renderStatus(res.state);
  });
  // Пока сессия заблокирована, обратный отсчёт на кнопке обновляется сам.
  setInterval(() => api.get().then(renderStatus), 15000);

  $('clear-key').addEventListener('click', () => {
    clearKey = true;
    dirty = true;
    $('clear-key').hidden = true;
    $('apiKey').placeholder = 'Ключ удалится после сохранения';
  });
  $('reset').addEventListener('click', async () => {
    if (!window.confirm('Вернуть настройки по умолчанию? Свои сайты и фразы удалятся, ключ останется.')) return;
    const st = await api.reset();
    fillForm(st);
    renderStatus(st);
    flash('Настройки сброшены');
  });

  // Изменения статуса приходят и из трея. Несохранённые правки в форме при этом не затираются.
  api.onState((st) => {
    renderStatus(st);
    if (!dirty) fillForm(st);
  });
  api.get().then((st) => {
    fillForm(st);
    renderStatus(st);
  });
})();
