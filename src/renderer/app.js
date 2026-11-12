// Интерфейс: связывает Акыла, облачко, панели и события из главного процесса.
/* global Buddy */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.nazar;

  const buddyEl = $('buddy');
  const buddy = new Buddy(buddyEl, $('buddy-canvas'));
  const bubble = $('bubble');
  const bubbleText = $('bubble-text');
  const bubbleQuick = $('bubble-quick');
  const panels = { onboarding: $('onboarding'), chat: $('chat'), report: $('report') };

  let state = null;
  let minutes = 25;
  let bubbleTimer = null;
  let typeTimer = null;
  let voiceOn = false;
  try { voiceOn = localStorage.getItem('voice') === '1'; } catch { /* нет хранилища */ }

  // ---------- Клики сквозь прозрачное окно ----------
  // Окно ловит мышь только когда курсор над элементом с классом .interactive.
  let interactive = false;
  let dragging = false;
  function setInteractive(on) {
    if (on === interactive) return;
    interactive = on;
    api.setInteractive(on);
  }
  let lastWave = 0;
  window.addEventListener('mousemove', (e) => {
    if (dragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    setInteractive(Boolean(el && el.closest('.interactive')));
    // Акыл следит глазами за курсором, если тот рядом, и машет, когда на него наводят мышь.
    const cx = buddy.x + buddy.width / 2;
    const cy = buddy.y + buddy.height / 2;
    buddy.lookToward(Math.hypot(e.clientX - cx, e.clientY - cy) < 320 ? e.clientX : null, e.clientY);
    const overBuddy = Boolean(el && el.closest('#buddy'));
    if (overBuddy && performance.now() - lastWave > 20000 && panels.chat.hidden) {
      lastWave = performance.now();
      buddy.wave();
    }
  });
  window.addEventListener('mouseleave', () => buddy.lookToward(null));

  // ---------- Перетаскивание и клик по Акылу ----------
  let down = null;
  buddyEl.addEventListener('mousedown', (e) => {
    down = { x: e.clientX, y: e.clientY, ox: e.clientX - buddy.x, oy: e.clientY - buddy.y, moved: false };
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!down) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
      down.moved = true;
      dragging = true;
      buddy.startDrag();
    }
    if (down.moved) buddy.dragTo(e.clientX - down.ox, e.clientY - down.oy);
  });
  window.addEventListener('mouseup', () => {
    if (!down) return;
    if (down.moved) {
      buddy.drop();
      say(pick(['Уииии!', 'Эй, аккуратнее 😅', 'Новое место — норм.']), { ms: 2000 });
    } else {
      toggleChat();
    }
    down = null;
    dragging = false;
  });

  // ---------- Облачко ----------
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function placeBubble(x, y) {
    if (bubble.hidden) return;
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    let left = x + buddy.width / 2 - 30;
    if (left + bw > window.innerWidth - 8) left = window.innerWidth - bw - 8;
    if (left < 8) left = 8;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${Math.max(8, y - bh - 22)}px`;
    bubble.style.setProperty('--tail', `${Math.max(12, Math.min(bw - 24, x + buddy.width / 2 - left - 6))}px`);
  }
  buddy.onMove = (x, y) => {
    placeBubble(x, y);
    placeChat(x, y);
  };

  function speak(text) {
    if (!voiceOn || !text || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const spoken = text.replace(/[#@$%&*!]{3,}/g, ' пи-ип! ').replace(/\*/g, '');
    const u = new SpeechSynthesisUtterance(spoken.replace(/[^\p{L}\p{N}\s.,!?«»—-]/gu, ''));
    u.lang = 'ru-RU';
    u.pitch = 1.6;
    u.rate = 1.1;
    speechSynthesis.speak(u);
  }

  function say(text, opts = {}) {
    if (!text) return;
    clearTimeout(bubbleTimer);
    clearInterval(typeTimer);
    bubble.hidden = false;
    bubble.classList.toggle('worried', opts.mood === 'worried');
    bubbleQuick.innerHTML = '';
    (opts.quick || []).forEach((label) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => handleQuick(label));
      bubbleQuick.appendChild(b);
    });
    // Эффект печатной машинки
    let i = 0;
    bubbleText.textContent = '';
    typeTimer = setInterval(() => {
      i += 2;
      bubbleText.textContent = text.slice(0, i);
      placeBubble(buddy.x, buddy.y);
      if (i >= text.length) clearInterval(typeTimer);
    }, 25);
    const ms = opts.ms || Math.max(3500, text.length * 70);
    if (hasCuss(text)) cuss(Math.min(ms, 4000));
    buddy.talk(Math.min(ms, text.length * 45));
    speak(text);
    if (!opts.sticky) bubbleTimer = setTimeout(() => (bubble.hidden = true), ms + (opts.quick ? 6000 : 0));
  }

  function handleQuick(label) {
    bubble.hidden = true;
    if (label.includes('Завершить')) api.endSession();
    else if (label.includes('15')) sendChat('Продли на 15 минут');
    else if (label.includes('по работе')) sendChat('Это по работе, запомни');
    else if (label.includes('Возвращаюсь')) say('Вот это настрой! Давай-давай, жду 👀', { mood: 'happy' });
  }

  // ---------- Ругается, пока человек в ленте ----------
  // Красный «!» висит над головой, Акыл злится и каждые ~12 с ворчит новой фразой.
  // Как только человек вернулся к делу (или перерыв, или конец сессии) — успокаивается.
  // Ругается «по-мультяшному»: настоящих слов нет, только #@$%! и пиканье.
  const SCOLD = [
    'Э, т#@%&*$с, э! Хорош отвлекаться, давай-давай, работай-работай!',
    'Опять {label}?! Э, т#@%&*$с, работай-работай! 🤬',
    'Закрывай {label}, #@$%! Давай-давай!',
    'Темп, темп, %#@&! «{goal}» сама себя не сделает!',
    'Хватит листать, $#@!! Работай-работай!',
    'Цель была «{goal}», а не {label}, #@$%&! Давай-давай!',
    'Ну сколько можно?! *пи-и-ип* *пи-и-ип*! 🤬 Работать!',
    'Я сейчас так выругаюсь, что цензура не спасёт! 🤬',
    'Ещё минута в ленте — и я начну топать громче, #@$!',
    'Балапан, работать! Раз-два, раз-два, давай-давай!',
    '%$#@&*!!! Это я так вежливо прошу вернуться 🙂',
  ];

  // Символы мата над головой мелькают ~3 секунды, пока он ругается.
  const GRAWLIX = ['#@$%!', '&%#@!', '$#!@%', '@#&!!', '*#@%&', '🤬#@$!', '%@#$!'];
  let cussTimer = null;
  function cuss(ms = 3000) {
    const el = $('cuss');
    clearInterval(cussTimer);
    el.hidden = false;
    const started = performance.now();
    cussTimer = setInterval(() => {
      if (performance.now() - started > ms) {
        clearInterval(cussTimer);
        el.hidden = true;
        return;
      }
      el.textContent = pick(GRAWLIX);
    }, 180);
    el.textContent = pick(GRAWLIX);
  }
  const hasCuss = (text) => /[#@$%&*]{2,}|пи-+и*-*п|🤬/.test(text || '');
  let scoldTimer = null;
  let blockedTimer = null;
  let scoldCount = 0;
  let scoldLabel = 'ленту';
  let lastScold = '';
  function scoldLine() {
    const goal = (state && state.session && state.session.goal) || 'цель';
    let line;
    do line = pick(SCOLD); while (line === lastScold && SCOLD.length > 1);
    lastScold = line;
    return line.replace('{goal}', goal).replace('{label}', scoldLabel);
  }
  function startScolding() {
    $('alert-mark').hidden = false;
    buddy.setAngry(true);
    if (scoldTimer) return;
    scoldCount = 0;
    scoldTimer = setInterval(() => {
      if (!panels.chat.hidden) return; // не перебиваем, пока человек пишет в чат
      scoldCount += 1;
      // После 6 фраз замолкает, но остаётся злым и с «!»: молчаливый укор.
      if (scoldCount > 6) return;
      // Первой всегда звучит фирменная фраза Акыла, дальше — вперемешку.
      const text = scoldCount === 1 ? SCOLD[0] : scoldLine();
      say(text, { mood: 'worried', quick: ['↩️ Возвращаюсь', '✅ Это по работе'], sticky: true });
    }, 12000);
  }
  function stopScolding() {
    if (!scoldTimer && $('alert-mark').hidden && !buddy.angry) return;
    clearInterval(scoldTimer);
    scoldTimer = null;
    $('alert-mark').hidden = true;
    $('cuss').hidden = true;
    clearInterval(cussTimer);
    buddy.setAngry(false);
  }

  // ---------- Реакции на события ----------
  function react(msg) {
    const { mood = 'normal', action } = msg;
    buddy.setMood(mood);
    if (action === 'run') {
      buddy.runTo(window.innerWidth / 2 - buddy.width / 2);
      startScolding();
    }
    // Попытка выключить во время блокировки: выбегает в центр, злится и трясёт кулаками ~7 секунд.
    if (action === 'blocked') {
      buddy.wake();
      $('zzz').hidden = true;
      buddy.runTo(window.innerWidth / 2 - buddy.width / 2);
      $('alert-mark').hidden = false;
      buddy.setAngry(true);
      clearTimeout(blockedTimer);
      blockedTimer = setTimeout(() => {
        if (scoldTimer) return; // человек ещё и в ленте — злость продолжается
        $('alert-mark').hidden = true;
        buddy.setAngry(false);
        buddy.goHome();
      }, 7000);
    }
    if (action === 'jump') buddy.jump();
    if (action === 'sleep') {
      stopScolding();
      buddy.sleep();
      $('zzz').hidden = false;
    }
    if (action === 'wake') {
      buddy.wake();
      $('zzz').hidden = true;
    }
    if (mood === 'happy') setTimeout(() => buddy.setMood('normal'), 4000);
    if (!msg.silent) say(msg.text, { mood, quick: msg.quick, sticky: Boolean(msg.quick) });
  }
  api.on('buddy-say', react);

  const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  // «1 раз», «2 раза», «5 раз»
  const times = (n) => {
    const d = n % 10;
    const dd = n % 100;
    return `${n} ${d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'раза' : 'раз'}`;
  };
  const fmtMin = (sec) => (sec < 60 ? `${Math.round(sec)} сек` : `${Math.round(sec / 60)} мин`);

  function renderHud(s) {
    const hud = $('hud');
    if (!s || !s.session) {
      hud.hidden = true;
      return;
    }
    const l = s.session;
    hud.hidden = false;
    $('hud-timer').textContent = l.onBreak ? `☕ ${fmt(l.breakLeftSec)}` : fmt(l.remainingSec);
    const sc = $('hud-score');
    sc.textContent = `${l.focusScore}%`;
    sc.className = `score ${l.focusScore < 50 ? 'low' : l.focusScore < 80 ? 'mid' : ''}`;
    $('hud-eye').hidden = !s.vision;
    $('hud-lock').hidden = !l.locked;
    if (!l.onBreak && !$('zzz').hidden) {
      $('zzz').hidden = true;
      buddy.wake();
    }
  }

  // Каждые 10 минут фокуса — тихая радость: прыжок и «🔥 10 мин» над головой, без облачка.
  let focusMilestone = 0;
  function pop(text) {
    const el = $('pop');
    el.textContent = text;
    el.hidden = false;
    el.classList.remove('go');
    void el.offsetWidth; // перезапуск CSS-анимации
    el.classList.add('go');
    setTimeout(() => (el.hidden = true), 1800);
  }

  function applyLook(s) {
    if (s && s.buddySize) buddy.setSize(s.buddySize);
  }

  api.on('activity', ({ verdict, state: s }) => {
    state = s;
    renderHud(s);
    const l = s.session;
    if (!l) {
      stopScolding();
      buddy.setContext('none');
      focusMilestone = 0;
      return;
    }
    if (l.onBreak) {
      stopScolding();
      return buddy.setContext('break');
    }
    const cat = verdict ? verdict.category : 'neutral';
    if (cat === 'distraction' && verdict.label) scoldLabel = verdict.label;
    if (cat === 'focus' || cat === 'away') stopScolding();
    buddy.setContext(cat === 'distraction' ? 'distraction' : 'focus');
    if (cat === 'focus') buddy.goHome();
    const m = Math.floor(l.totals.focus / 600);
    if (m > focusMilestone) {
      focusMilestone = m;
      if (buddy.cheer()) pop(`🔥 ${m * 10} мин`);
    }
    // Лёгкое беспокойство, пока отвлечение ещё не дошло до напоминания
    if (verdict && verdict.category === 'distraction' && buddy.mood === 'normal') buddy.setMood('worried');
    if (verdict && verdict.category !== 'distraction' && buddy.mood === 'worried') buddy.setMood('normal');
  });
  api.on('state', (s) => {
    state = s;
    renderHud(s);
    applyLook(s);
  });
  api.on('vision', (v) => {
    $('hud-eye').title = `Акыл видит: ${v.activity}`;
  });

  // ---------- Старт сессии ----------
  function openOnboarding() {
    Object.values(panels).forEach((p) => (p.hidden = true));
    bubble.hidden = true;
    const p = panels.onboarding;
    p.hidden = false;
    p.style.left = `${Math.max(16, Math.min(window.innerWidth - 360, buddy.x))}px`;
    p.style.top = `${Math.max(16, buddy.ground() - p.offsetHeight - 30)}px`;
    $('vision').disabled = !(state && state.ai);
    $('vision').checked = Boolean(state && state.vision);
    $('strict').checked = Boolean(state && state.strictDefault);
    $('ai-hint').textContent = state && state.ai
      ? `ИИ: ${state.model}`
      : 'Офлайн-режим: добавь ANTHROPIC_API_KEY в .env, чтобы включить ИИ-чат и зрение.';
    if (state && !state.trackingSupported) $('ai-hint').textContent += ' Отслеживание окон недоступно на этой системе — используй демо-режим в трее.';
    setTimeout(() => $('goal').focus(), 50);
  }
  $('minutes').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    minutes = Number(b.dataset.min);
    [...$('minutes').children].forEach((x) => x.classList.toggle('active', x === b));
  });
  async function start() {
    const goal = $('goal').value.trim();
    if (!goal) {
      say('Сначала цель, потом лента 😉 Напиши, над чем работаем.', { mood: 'worried' });
      $('goal').focus();
      return;
    }
    panels.onboarding.hidden = true;
    state = await api.startSession({ goal, minutes, vision: $('vision').checked, strict: $('strict').checked });
    if (state.session && state.session.locked) say(`🔒 Блокировка включена: до конца сессии меня не выключить. Сдаться можно только словами «я сдаюсь».`, { ms: 6000 });
    $('chat-log').innerHTML = '';
    renderHud(state);
  }
  $('start').addEventListener('click', start);
  $('goal').addEventListener('keydown', (e) => e.key === 'Enter' && start());
  $('onb-close').addEventListener('click', () => {
    panels.onboarding.hidden = true;
    say('Окей! Нажми на меня, когда будешь готов.');
  });
  api.on('open-onboarding', openOnboarding);

  // ---------- Чат ----------
  function placeChat(x, y) {
    const c = panels.chat;
    if (c.hidden) return;
    let left = x + buddy.width + 12;
    if (left + 340 > window.innerWidth - 8) left = x - 352;
    c.style.left = `${Math.max(8, left)}px`;
    c.style.top = `${Math.max(8, Math.min(window.innerHeight - 400, y - 300))}px`;
  }
  function toggleChat() {
    if (!state || !state.session) {
      if (panels.onboarding.hidden) openOnboarding();
      return;
    }
    const c = panels.chat;
    c.hidden = !c.hidden;
    $('chat-mode').textContent = state.ai ? 'ИИ' : 'офлайн';
    $('voice-toggle').textContent = voiceOn ? '🔊' : '🔇';
    if (!c.hidden) {
      bubble.hidden = true;
      placeChat(buddy.x, buddy.y);
      if (!$('chat-log').children.length) addMsg('bot', `Я тут! Цель: «${state.session.goal}». Можешь попросить перерыв, спросить, как дела, или просто поболтать.`);
      setTimeout(() => $('chat-input').focus(), 50);
    }
  }
  api.on('toggle-chat', toggleChat);
  $('chat-close').addEventListener('click', () => (panels.chat.hidden = true));
  $('voice-toggle').addEventListener('click', () => {
    voiceOn = !voiceOn;
    try { localStorage.setItem('voice', voiceOn ? '1' : '0'); } catch { /* нет хранилища */ }
    $('voice-toggle').textContent = voiceOn ? '🔊' : '🔇';
  });

  function addMsg(who, text) {
    const d = document.createElement('div');
    d.className = `msg ${who}`;
    d.textContent = text;
    $('chat-log').appendChild(d);
    $('chat-log').scrollTop = 1e9;
    return d;
  }
  async function sendChat(text) {
    if (!text) return;
    if (panels.chat.hidden) toggleChat();
    addMsg('me', text);
    const typing = addMsg('bot typing', '…');
    buddy.talk(1500);
    const res = await api.chat(text);
    typing.remove();
    addMsg('bot', res.reply);
    speak(res.reply);
    buddy.talk(Math.min(4000, res.reply.length * 45));
    if (res.action === 'break') {
      react({ silent: true, mood: 'normal', action: 'sleep' });
    }
  }
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('chat-input').value.trim();
    $('chat-input').value = '';
    sendChat(t);
  });
  document.querySelectorAll('#chat .quick button').forEach((b) => b.addEventListener('click', () => sendChat(b.dataset.say)));

  // ---------- Чек внимания ----------
  let reportId = null;
  api.on('report', ({ summary: s, profile: p }) => {
    reportId = s.id;
    stopScolding();
    Object.values(panels).forEach((x) => (x.hidden = true));
    bubble.hidden = true;
    $('zzz').hidden = true;
    buddy.wake();
    $('r-goal').textContent = `🎯 ${s.goal}`;
    $('r-score').textContent = s.focusScore;
    $('r-time').textContent = `${s.elapsedMin} из ${s.plannedMin} мин`;
    $('r-focus').textContent = fmtMin(s.totals.focus);
    $('r-dist').textContent = fmtMin(s.totals.distraction);
    $('r-attempts-row').hidden = !s.shutdownAttempts;
    $('r-attempts').textContent = `${times(s.shutdownAttempts)} 😤`;
    $('r-surrender-row').hidden = !s.surrendered;
    const away = s.totals.away || 0;
    $('r-away-row').hidden = away < 60;
    $('r-away').textContent = fmtMin(away);
    $('r-nudges').textContent = times(s.nudges);
    $('r-returns').textContent = times(s.returns);
    $('r-thieves').textContent = s.topDistractors.length ? s.topDistractors.map((d) => `${d.label} ${fmtMin(d.sec)}`).join(', ') : 'не нашлось 💪';
    $('r-xp').textContent = `+${s.xpEarned} (всего ${p.xp})`;
    $('r-level').textContent = `${p.level} · серия ${p.streak} дн.`;
    $('r-insight').textContent = 'думаю…';
    const tl = $('r-timeline');
    tl.innerHTML = '';
    (s.timeline.length ? s.timeline : ['neutral']).forEach((cat) => {
      const i = document.createElement('i');
      i.className = cat;
      tl.appendChild(i);
    });
    panels.report.hidden = false;
    buddy.setMood(s.focusScore >= 70 ? 'happy' : 'normal');
    buddy.jump();
    state = { ...(state || {}), session: null };
    renderHud(state);
  });
  api.on('report-insight', ({ id, text }) => {
    if (id === reportId) $('r-insight').textContent = text;
  });
  $('r-new').addEventListener('click', () => {
    panels.report.hidden = true;
    $('goal').value = '';
    openOnboarding();
  });
  $('r-close').addEventListener('click', () => {
    panels.report.hidden = true;
    say('Отдыхай! Нажми на меня, когда начнём новую сессию.');
  });

  // ---------- Первый запуск: Акыл выходит из-за края экрана ----------
  api.getState().then((s) => {
    state = s;
    applyLook(s);
    renderHud(s);
    buddy.walkTo(Math.min(260, window.innerWidth / 3));
    setTimeout(() => {
      say(pick(['Салем! Я Акыл. Над чем работаем?', 'Привет! Я Акыл. Говори цель — и погнали, работай-работай!']), { ms: 5000 });
      if (!s.session) setTimeout(() => !(state && state.session) && openOnboarding(), 1800);
    }, 3500);
  });
})();
