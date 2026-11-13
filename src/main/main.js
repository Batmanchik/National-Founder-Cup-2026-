// Главный процесс Electron: окно управления, прозрачный оверлей с Акылом, трей, трекинг активности, ИИ.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, desktopCapturer, globalShortcut, safeStorage, powerMonitor } = require('electron');
const { ActivityWatcher } = require('./activity');
const { classify, windowKeyword, isSelf } = require('./classifier');
const { Session, applyIdle, BET_TARGET } = require('./session');
const { Store } = require('./store');
const { SettingsStore } = require('./settings');
const mentor = require('./mentor');
const lines = require('./lines');
const { clamp, fmtMin, fmtTenge, minutes: minutesText, minutesAcc, points } = require('../shared/util');
const voice = require('./voice');
const { makeTrayIcon } = require('./icon');
const { LockFile } = require('./lock-file');
const { trayMenuTemplate } = require('./tray-menu');

const TICK_MS = 2000;
const HIDDEN_START = process.argv.includes('--hidden'); // автозапуск при входе в Windows: без окна управления

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.disableHardwareAcceleration();
}
if (!app.requestSingleInstanceLock()) app.exit(0);

let win = null; // оверлей с Акылом; существует, только пока Акыл включён
let panel = null; // обычное окно управления
let tray = null;
let store = null;
let settings = null;
let session = null;
let quitting = false;
let systemQuitting = false; // выключение или перезагрузка Windows: блокировка не мешает
let lockFile = null; // снимок заблокированной сессии на случай, если Nazar убьют
let restoredKind = null; // 'killed' — Nazar убили; 'reboot' — выключался компьютер
let visionEnabled = false;
let lastVision = null; // { on_task, activity, confidence, comment, at, key }
let tickTimer = null;
let visionTimer = null;
const windowCache = new Map(); // ключ окна -> вердикт ИИ
const pendingWindow = new Set();
let chatHistory = [];
let lastExternal = { app: '', title: '', url: '' }; // последнее окно не Nazar: пока пишешь в чат, активен сам Nazar
const watcher = new ActivityWatcher();

const mentorOn = () => Boolean(win && !win.isDestroyed());
const send = (channel, data) => mentorOn() && win.webContents.send(channel, data);
const winKey = (w) => `${w.app}|${w.title}|${w.url}`;
const say = (text, opts = {}) => send('buddy-say', { text, ...opts });

// ---------- Блокировка выключения ----------
// Пока идёт сессия с блокировкой, Акыла нельзя выключить, закрыть или завершить сессию раньше времени.
// Выход один — честно сдаться (фраза «я сдаюсь»), тогда в чеке будет отметка.
// Выключение компьютера блокировка не держит: сессия сохранится и продолжится после включения.
const locked = () => Boolean(session && session.isLocked() && !systemQuitting);

const persistActive = (force = false) => lockFile && lockFile.save(session, force);
const clearActive = () => lockFile && lockFile.clear();

// Компьютер выключается: это не попытка сбежать, сессия продолжится после включения.
function markSystemShutdown() {
  systemQuitting = true;
  if (session && session.strict) session.systemShutdown = true;
  persistActive(true);
}

// Попытка выключить во время блокировки: Акыл бежит к центру и ругается, чем дальше — тем злее.
function blockAttempt() {
  session.shutdownAttempts += 1;
  persistActive(true);
  const text = lines.blockLine({ n: session.shutdownAttempts, goal: session.goal, leftSec: session.lockLeftSec() });
  say(text, { mood: 'worried', action: 'blocked' });
  notifyPanel();
  return text;
}

function surrender() {
  if (!session) return null;
  session.surrendered = true;
  clearActive();
  say(lines.line('surrender'), { mood: 'normal' });
  setTimeout(endSession, 1500);
  return true;
}

function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Клики проходят сквозь прозрачное окно; renderer включает приём мыши, когда курсор над Акылом или панелью.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Alt+F4 по оверлею тоже не выключает Акыла во время блокировки.
  win.on('close', (e) => {
    if (!locked()) return;
    e.preventDefault();
    blockAttempt();
  });
  // Windows выключается или перезагружается: не мешаем, сессия сохранена и продолжится.
  win.on('query-session-end', markSystemShutdown);
}

function restartVisionTimer() {
  clearInterval(visionTimer);
  visionTimer = mentorOn() ? setInterval(visionTick, settings.data.visionIntervalSec * 1000) : null;
}

function startMentor() {
  if (mentorOn()) return;
  createOverlay();
  watcher.start();
  tickTimer = setInterval(tick, TICK_MS);
  restartVisionTimer();
  globalShortcut.register('CommandOrControl+Shift+Space', openChat);
  globalShortcut.register('CommandOrControl+Shift+9', demo.distract);
  globalShortcut.register('CommandOrControl+Shift+0', demo.work);
  buildTrayMenu();
  notifyPanel();
}

// Выключение сохраняет незавершённую сессию в историю, чтобы время не пропало.
function stopMentor() {
  if (!mentorOn()) return;
  if (locked()) {
    blockAttempt();
    return;
  }
  if (session) {
    // Компьютер выключается посреди заблокированной сессии: она продолжится после включения, в историю пока не пишем.
    if (systemQuitting && session.strict && session.isLocked()) persistActive(true);
    else {
      store.addSession(session.summary());
      clearActive();
    }
    session = null;
  }
  clearInterval(tickTimer);
  clearInterval(visionTimer);
  tickTimer = visionTimer = null;
  globalShortcut.unregisterAll();
  watcher.stop();
  win.destroy();
  win = null;
  buildTrayMenu();
  notifyPanel();
}

function toggleMentor() {
  if (mentorOn()) stopMentor();
  else startMentor();
}

function openPanel() {
  if (panel && !panel.isDestroyed()) {
    panel.show();
    panel.focus();
    return;
  }
  panel = new BrowserWindow({
    width: 620,
    height: 800,
    minWidth: 520,
    minHeight: 520,
    title: 'Nazar',
    icon: makeTrayIcon(),
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f4f4e8',
    webPreferences: {
      preload: path.join(__dirname, '..', 'panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  panel.once('ready-to-show', () => panel.show());
  // Пока Акыл включён, крестик только прячет окно в трей. Если Акыл выключен, приложение закрывается.
  panel.on('close', (e) => {
    if (quitting) return;
    if (mentorOn()) {
      e.preventDefault();
      panel.hide();
    } else {
      app.quit();
    }
  });
  panel.on('closed', () => (panel = null));
  panel.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));
}

function panelState() {
  return {
    mentorOn: mentorOn(),
    goal: session ? session.goal : null,
    settings: settings.view(),
    ai: mentor.hasAI(),
    canAutostart: app.isPackaged,
    canEncrypt: safeStorage.isEncryptionAvailable(),
    locked: locked(),
    lockLeftSec: session ? session.lockLeftSec() : 0,
    attempts: session ? session.shutdownAttempts : 0,
  };
}

function notifyPanel() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('panel-state', panelState());
}

function applySettings() {
  const s = settings.data;
  mentor.configure({ apiKey: settings.apiKey(), model: s.model, lines: { drift: s.driftLines, back: s.backLines } });
  visionEnabled = s.vision && mentor.hasAI();
  windowCache.clear();
  if (session) session.setDriftSec(s.driftSec);
  restartVisionTimer();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.autoStart, args: ['--hidden'] });
  buildTrayMenu();
  if (mentorOn()) send('state', liveState());
}

function liveState() {
  return {
    session: session ? session.live() : null,
    profile: store.profile(),
    vision: visionEnabled,
    ai: mentor.hasAI(),
    model: mentor.MODEL,
    trackingSupported: watcher.supported,
    buddySize: settings.data.buddySize,
    strictDefault: settings.data.strictMode,
    speak: settings.data.speak,
    platform: process.platform,
  };
}

// Итоговый вердикт по окну: правила -> кэш ИИ по заголовку -> свежий анализ скриншота.
function verdictFor(w) {
  let v = classify(w, session.goal, { focus: settings.data.focusSites, distract: settings.data.distractSites });
  const key = winKey(w);
  if (v.soft && mentor.hasAI()) {
    const cached = windowCache.get(key);
    if (cached) v = { ...v, category: cached.category, reason: `ИИ: ${cached.reason}` };
    else if (!pendingWindow.has(key)) {
      pendingWindow.add(key);
      mentor.classifyWindow(session.goal, w).then((res) => {
        pendingWindow.delete(key);
        if (res) {
          windowCache.set(key, res);
          if (windowCache.size > 300) windowCache.delete(windowCache.keys().next().value); // не растёт бесконечно
        }
      });
    }
  }
  if (lastVision && lastVision.key === key && Date.now() - lastVision.at < settings.data.visionIntervalSec * 2000) {
    if (lastVision.on_task && lastVision.confidence >= 0.6) v = { ...v, category: 'focus', reason: `зрение: ${lastVision.activity}` };
    else if (!lastVision.on_task && lastVision.confidence >= 0.6 && v.category !== 'focus')
      v = { ...v, category: 'distraction', reason: `зрение: ${lastVision.activity}` };
  }
  return v;
}

const DRIFT_QUICK = ['↩️ Возвращаюсь', '✅ Это по работе'];

function chatContext() {
  return {
    goal: session ? session.goal : 'не задана',
    live: session ? session.live() : null,
    window: lastExternal,
    vision: lastVision,
    memory: store.memory(),
  };
}

function handleEvent(ev, w, v) {
  const vars = { goal: session.goal, label: v.label };
  if (ev === 'drift')
    say(lines.driftLine({ ...vars, nudges: session.nudges, memory: store.memory() }), {
      mood: 'worried',
      action: 'run',
      quick: DRIFT_QUICK,
    });
  if (ev === 'drift-long') {
    if (lastVision && lastVision.comment) say(lastVision.comment, { mood: 'worried', action: 'run', quick: DRIFT_QUICK });
    else {
      // ИИ пишет личное напоминание; если он молчит дольше 5 секунд или ключа нет — шаблон.
      const current = session;
      mentor.nudge(chatContext()).then((text) => {
        if (session !== current || !session.longNotified) return; // человек уже вернулся
        // Без ИИ: если лента уже «заработала» заметную сумму — напоминаем деньгами, это действует сильнее.
        const money = session.live().adValue;
        const fallback = money >= 1 ? lines.line('driftMoney', { ...vars, money: fmtTenge(money) }) : lines.line('driftLong', vars);
        say(text || fallback, { mood: 'worried', action: 'run', quick: DRIFT_QUICK });
      });
    }
  }
  if (ev === 'bet-danger') {
    say(lines.line('betDanger', { points: points(session.bet), target: BET_TARGET, score: session.focusScore() }), { mood: 'worried' });
  }
  if (ev === 'break-due') {
    const m = session.earnedBreak();
    say(lines.line('breakDue', { work: minutesText(Math.round(session.focusSinceBreak / 60)), m: minutesAcc(m) }), {
      mood: 'happy',
      quick: [`☕ Перерыв ${m} мин`, '💪 Ещё поработаю'],
    });
  }
  if (ev === 'back') say(lines.line('back', vars), { mood: 'happy', action: 'jump' });
  if (ev === 'break-over') say(lines.line('breakOver', vars), { mood: 'normal', action: 'wake' });
  if (ev === 'time-up') {
    const unlocked = session.strict && !session.surrendered ? ` ${lines.line('unlocked')}` : '';
    say(lines.line('timeUp', vars) + unlocked, { mood: 'happy', action: 'jump', quick: ['✅ Завершить', '➕ Ещё 15 минут'] });
    buildTrayMenu();
    notifyPanel();
  }
}

function tick() {
  const w = watcher.window;
  if ((w.app || w.title) && !isSelf(w)) lastExternal = w;
  if (!session) return send('activity', { window: w, verdict: null, state: liveState() });
  const v = applyIdle(verdictFor(w), powerMonitor.getSystemIdleTime());
  const events = session.record(v, TICK_MS / 1000);
  send('activity', { window: w, verdict: v, state: liveState() });
  events.forEach((ev) => handleEvent(ev, w, v));
  persistActive();
}

async function visionTick() {
  if (!visionEnabled || !session || session.isOnBreak() || !mentor.hasAI()) return;
  const w = watcher.window;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 800 } });
    const img = sources[0] && sources[0].thumbnail;
    if (!img || img.isEmpty()) return;
    const res = await mentor.analyzeScreen(session.goal, w, img.toJPEG(55).toString('base64'));
    if (!res) return;
    lastVision = { ...res, at: Date.now(), key: winKey(w) };
    send('vision', lastVision);
  } catch (err) {
    console.error('[vision]', err.message);
  }
}

function startSession({ goal, minutes, vision, strict, bet }) {
  if (locked()) return liveState(); // новую сессию поверх заблокированной не начать
  if (typeof vision === 'boolean') visionEnabled = vision;
  const strictOn = typeof strict === 'boolean' ? strict : settings.data.strictMode;
  // Новая сессия поверх незаблокированной (например, «Новая сессия…» в трее): старую сохраняем, а не теряем.
  if (session) {
    store.addSession(session.summary());
    clearActive();
  }
  // Ставить можно только то, что есть: баллов меньше ставки — ставка не принимается.
  const stake = clamp(bet, 0, store.data.xp, 0);
  const allIn = stake > 0 && stake === store.data.xp;
  session = new Session({ goal, minutes, driftSec: settings.data.driftSec, strict: strictOn, bet: stake });
  persistActive(true);
  chatHistory = [];
  lastVision = null;
  const start = lines.startLine(session.goal, store.memory());
  const betLine = session.bet
    ? ` ${lines.line(allIn ? 'betAllIn' : 'betStart', { points: points(session.bet), target: BET_TARGET, double: session.bet * 2 })}`
    : '';
  say(start + betLine, { mood: 'happy', action: 'jump' });
  buildTrayMenu();
  notifyPanel();
  return liveState();
}

function endSession() {
  if (!session) return null;
  if (locked()) {
    // Досрочно завершить нельзя — только сдаться.
    say(lines.line('endEarly', { left: fmtMin(session.lockLeftSec()) }), { mood: 'worried', action: 'blocked' });
    return null;
  }
  clearActive();
  const summary = session.summary();
  const memoryBefore = store.memory(); // сравниваем с прошлым, без текущей сессии
  store.addSession(summary);
  session = null;
  buildTrayMenu();
  notifyPanel();
  const report = { summary, profile: store.profile(), ad: store.adValue() };
  send('report', report);
  mentor.reportInsight(summary, memoryBefore).then((text) => send('report-insight', { id: summary.id, text }));
  return report;
}

// «Это по работе» / «это отвлечение»: Акыл дописывает окно в нужный список настроек и больше не путает.
function rememberWindow(kind, keyword) {
  const word = String(keyword || windowKeyword(lastExternal))
    .trim()
    .slice(0, 80);
  if (!word) return '';
  const key = word.toLowerCase();
  const without = (list) => list.filter((x) => x.toLowerCase() !== key);
  const s = settings.data;
  const patch =
    kind === 'focus'
      ? { focusSites: [...without(s.focusSites), word], distractSites: without(s.distractSites) }
      : { distractSites: [...without(s.distractSites), word], focusSites: without(s.focusSites) };
  settings.update(patch);
  applySettings();
  notifyPanel();
  return word;
}

function applyAction(res) {
  if (res.action === 'mark_focus' || res.action === 'mark_distraction') {
    const kind = res.action === 'mark_focus' ? 'focus' : 'distraction';
    const word = rememberWindow(kind, res.keyword);
    if (kind === 'focus' && session) session.forgiveDrift();
    if (!res.reply)
      res.reply = word
        ? lines.line(kind === 'focus' ? 'marked' : 'markedDistraction', { keyword: word })
        : 'Не понял, какое окно запомнить. Открой его и напиши ещё раз.';
    return;
  }
  if (!session) {
    if (!res.reply) res.reply = 'Сначала начнём сессию — нажми на меня и назови цель!';
    return;
  }
  if (res.action === 'break') {
    // Перерыв выдаётся по заработанному фокусу, а не по просьбе (см. session.js); ответ Акыла объясняет почему.
    const r = session.grantBreak(res.minutes);
    const vars = { goal: session.goal, work: minutesText(r.focusMin), m: minutesAcc(r.minutes), asked: minutesAcc(r.requested) };
    if (r.refused) {
      res.action = 'none';
      res.reply = lines.line('breakEarly', { ...vars, need: Math.max(1, r.needMin) });
      return;
    }
    res.minutes = r.minutes;
    res.reply = lines.line(r.requested > r.minutes ? 'breakCut' : 'breakOk', vars);
    send('buddy-say', { text: '', mood: 'sleep', action: 'sleep', silent: true, breakMin: r.minutes });
  } else if (res.action === 'extend') {
    session.extend(res.minutes || 15);
  } else if (res.action === 'end_session') {
    if (locked()) res.reply = lines.line('endEarly', { left: fmtMin(session.lockLeftSec()) });
    else setTimeout(endSession, 1200);
  }
}

function buildTrayMenu() {
  if (!tray) return;
  const template = trayMenuTemplate(
    { mentorOn: mentorOn(), locked: locked(), goal: session ? session.goal : null, vision: visionEnabled, ai: mentor.hasAI() },
    {
      openPanel,
      toggleMentor,
      newSession: () => send('open-onboarding'),
      endSession,
      openChat,
      setVision: (on) => {
        visionEnabled = on;
        send('state', liveState());
      },
      demoDistract: () => demo.distract(),
      demoWork: () => demo.work(),
      quit: () => app.quit(),
    }
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// Демо-режим для защиты: подменяет активное окно на 40 секунд (на случай, если трекинг ОС недоступен).
const demo = {
  distract: () => watcher.simulate({ app: 'chrome', title: 'Reels • Instagram', url: 'https://www.instagram.com/reels/' }, 40),
  work: () => watcher.simulate({ app: 'Code', title: 'main.js — Visual Studio Code', url: '' }, 40),
};
global.nazarDemo = demo;

function openChat() {
  if (!mentorOn()) return;
  win.focus();
  send('toggle-chat');
}

ipcMain.on('set-interactive', (_e, on) => {
  if (!mentorOn()) return;
  if (on) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
});
ipcMain.handle('get-state', () => liveState());
// Голос Акыла: WAV от нейросети Piper или null (тогда интерфейс говорит системным синтезатором).
ipcMain.handle('tts', async (_e, text) => {
  try {
    return await voice.speak(app, String(text || '').slice(0, 600));
  } catch (err) {
    console.error('[voice]', err.message);
    return null;
  }
});
ipcMain.handle('set-speak', (_e, on) => {
  settings.update({ speak: Boolean(on) });
  notifyPanel();
  send('state', liveState());
  return settings.data.speak;
});
ipcMain.handle('start-session', (_e, opts) => startSession(opts || {}));
ipcMain.handle('end-session', () => endSession());
ipcMain.handle('set-vision', (_e, on) => {
  visionEnabled = Boolean(on) && mentor.hasAI();
  buildTrayMenu();
  return liveState();
});
ipcMain.handle('chat', async (_e, text) => {
  const t = String(text).toLowerCase();
  if (locked() && /сда[её]?юсь|сдаюс|берілемін/.test(t) && !/не\s+сда/.test(t)) {
    const reply = lines.line('surrender');
    surrender();
    return { reply, action: 'end_session', minutes: 0, ai: false };
  }
  const res = await mentor.chat(chatHistory, String(text).slice(0, 1000), chatContext());
  applyAction(res); // может дописать reply (например, «запомнил»)
  chatHistory.push({ role: 'user', content: String(text) }, { role: 'assistant', content: res.reply });
  return res;
});

// Окно управления
ipcMain.handle('panel-get', () => panelState());
ipcMain.handle('panel-toggle', () => {
  toggleMentor(); // при блокировке не выключит, а отругает
  return panelState();
});
// Сдаться можно, только вписав «я сдаюсь»: так выход есть всегда, но он осознанный.
ipcMain.handle('panel-surrender', (_e, phrase) => {
  if (!locked()) return { ok: false, error: 'Сессия не заблокирована', state: panelState() };
  const norm = String(phrase || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (norm !== 'я сдаюсь') return { ok: false, error: 'Впиши ровно: я сдаюсь', state: panelState() };
  surrender();
  return { ok: true, state: panelState() };
});
ipcMain.handle('panel-save', (_e, patch) => {
  try {
    settings.update(patch || {});
    applySettings();
    return { ok: true, state: panelState() };
  } catch (err) {
    return { ok: false, error: err.message, state: panelState() };
  }
});
ipcMain.handle('panel-reset', () => {
  settings.reset();
  applySettings();
  return panelState();
});

function envDefaults() {
  const out = {};
  if (process.env.NAZAR_DRIFT_SEC) out.driftSec = process.env.NAZAR_DRIFT_SEC;
  if (process.env.NAZAR_MODEL) out.model = process.env.NAZAR_MODEL;
  if (process.env.NAZAR_VISION) out.vision = process.env.NAZAR_VISION === 'on';
  if (process.env.NAZAR_VISION_INTERVAL_SEC) out.visionIntervalSec = process.env.NAZAR_VISION_INTERVAL_SEC;
  return out;
}

app.on('second-instance', () => openPanel());
app.on('before-quit', (e) => {
  if (locked()) {
    e.preventDefault();
    blockAttempt();
    return;
  }
  quitting = true;
});
app.on('window-all-closed', () => {}); // приложение живёт в трее, закрытие окон его не завершает

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  const crypto = safeStorage.isEncryptionAvailable()
    ? {
        encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
        decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')),
      }
    : null;
  settings = new SettingsStore(app.getPath('userData'), crypto, envDefaults());
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('Nazar — ментор Акыл');
  tray.on('click', openPanel);
  applySettings();
  powerMonitor.on('shutdown', markSystemShutdown);
  lockFile = new LockFile(path.join(app.getPath('userData'), 'nazar-active.json'));
  const restored = restoreActive();
  if (restored || settings.data.startMentorOnOpen || HIDDEN_START) startMentor();
  if (restored) {
    // Nazar убили посреди заблокированной сессии: продолжаем и высказываем всё, что думаем.
    setTimeout(() => {
      if (!session) return;
      const vars = { goal: session.goal, left: fmtMin(session.lockLeftSec()) };
      if (restoredKind === 'killed') say(lines.line('killed', vars), { mood: 'worried', action: 'blocked' });
      else say(lines.line('resumed', vars), { mood: 'normal', action: 'jump' });
    }, 5000);
  }
  if (!HIDDEN_START) openPanel();
  if (process.platform === 'darwin' && app.dock && HIDDEN_START) app.dock.hide();
});

// Снимок заблокированной сессии остался — значит, Nazar закрыли не по-честному (или выключился компьютер).
function restoreActive() {
  const snap = lockFile.load();
  if (!snap || !snap.startedAt) return false;
  const restoredSession = Session.restore(snap);
  if (restoredSession.isLocked()) {
    session = restoredSession;
    restoredKind = session.systemShutdown ? 'reboot' : 'killed';
    if (restoredKind === 'killed') session.shutdownAttempts += 1;
    delete session.systemShutdown;
    persistActive(true);
    return true;
  }
  // Время сессии уже вышло, пока Nazar был закрыт: сохраняем её в историю, чтобы ничего не пропало.
  const end = restoredSession.startedAt + restoredSession.plannedMin * 60000;
  store.addSession(restoredSession.summary(end));
  clearActive();
  return false;
}

app.on('will-quit', () => {
  stopMentor();
  globalShortcut.unregisterAll();
  watcher.stop();
});
