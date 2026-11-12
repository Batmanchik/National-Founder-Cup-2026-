// Главный процесс Electron: окно управления, прозрачный оверлей с Акылом, трей, трекинг активности, ИИ.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, desktopCapturer, globalShortcut, safeStorage, powerMonitor } = require('electron');
const { ActivityWatcher } = require('./activity');
const { classify, windowKeyword, isSelf } = require('./classifier');
const { Session, applyIdle } = require('./session');
const { Store } = require('./store');
const { SettingsStore } = require('./settings');
const mentor = require('./mentor');
const { makeTrayIcon } = require('./icon');

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
  if (session) {
    store.addSession(session.summary());
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
        if (res) windowCache.set(key, res);
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
    say(mentor.driftLine({ ...vars, nudges: session.nudges, memory: store.memory() }), { mood: 'worried', action: 'run', quick: DRIFT_QUICK });
  if (ev === 'drift-long') {
    if (lastVision && lastVision.comment) say(lastVision.comment, { mood: 'worried', action: 'run', quick: DRIFT_QUICK });
    else {
      // ИИ пишет личное напоминание; если он молчит дольше 5 секунд или ключа нет — шаблон.
      const current = session;
      mentor.nudge(chatContext()).then((text) => {
        if (session !== current || !session.longNotified) return; // человек уже вернулся
        say(text || mentor.line('driftLong', vars), { mood: 'worried', action: 'run', quick: DRIFT_QUICK });
      });
    }
  }
  if (ev === 'back') say(mentor.line('back', vars), { mood: 'happy', action: 'jump' });
  if (ev === 'break-over') say(mentor.line('breakOver', vars), { mood: 'normal', action: 'wake' });
  if (ev === 'time-up') say(mentor.line('timeUp', vars), { mood: 'happy', action: 'jump', quick: ['✅ Завершить', '➕ Ещё 15 минут'] });
}

function tick() {
  const w = watcher.window;
  if ((w.app || w.title) && !isSelf(w)) lastExternal = w;
  if (!session) return send('activity', { window: w, verdict: null, state: liveState() });
  const v = applyIdle(verdictFor(w), powerMonitor.getSystemIdleTime());
  const events = session.record(v, TICK_MS / 1000);
  send('activity', { window: w, verdict: v, state: liveState() });
  events.forEach((ev) => handleEvent(ev, w, v));
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

function startSession({ goal, minutes, vision }) {
  if (typeof vision === 'boolean') visionEnabled = vision;
  session = new Session({ goal, minutes, driftSec: settings.data.driftSec });
  chatHistory = [];
  lastVision = null;
  say(mentor.startLine(session.goal, store.memory()), { mood: 'happy', action: 'jump' });
  buildTrayMenu();
  notifyPanel();
  return liveState();
}

function endSession() {
  if (!session) return null;
  const summary = session.summary();
  const memoryBefore = store.memory(); // сравниваем с прошлым, без текущей сессии
  store.addSession(summary);
  session = null;
  buildTrayMenu();
  notifyPanel();
  const report = { summary, profile: store.profile() };
  send('report', report);
  mentor.reportInsight(summary, memoryBefore).then((text) => send('report-insight', { id: summary.id, text }));
  return report;
}

// «Это по работе» / «это отвлечение»: Акыл дописывает окно в нужный список настроек и больше не путает.
function rememberWindow(kind, keyword) {
  const word = String(keyword || windowKeyword(lastExternal)).trim().slice(0, 80);
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
    if (!res.reply) res.reply = word ? mentor.line(kind === 'focus' ? 'marked' : 'markedDistraction', { keyword: word }) : 'Не понял, какое окно запомнить. Открой его и напиши ещё раз.';
    return;
  }
  if (!session) return;
  if (res.action === 'break') {
    const m = session.grantBreak(res.minutes || 5);
    send('buddy-say', { text: '', mood: 'sleep', action: 'sleep', silent: true, breakMin: m });
  } else if (res.action === 'extend') {
    session.extend(res.minutes || 15);
  } else if (res.action === 'end_session') {
    setTimeout(endSession, 1200);
  }
}

function buildTrayMenu() {
  if (!tray) return;
  const on = mentorOn();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть Nazar', click: openPanel },
      { label: on ? 'Выключить Акыла' : 'Включить Акыла', click: toggleMentor },
      { type: 'separator' },
      { label: session ? `🎯 ${session.goal}` : 'Нет активной сессии', enabled: false },
      { label: 'Новая сессия…', enabled: on, click: () => send('open-onboarding') },
      { label: 'Завершить сессию и показать чек', enabled: Boolean(session), click: endSession },
      { label: 'Чат с Акылом  (Ctrl+Shift+Space)', enabled: on, click: () => openChat() },
      { type: 'separator' },
      {
        label: 'Зрение: анализ экрана ИИ',
        type: 'checkbox',
        checked: visionEnabled,
        enabled: mentor.hasAI(),
        click: (item) => {
          visionEnabled = item.checked;
          send('state', liveState());
        },
      },
      { label: 'Демо: отвлечение на Reels  (Ctrl+Shift+9)', enabled: on, click: () => demo.distract() },
      { label: 'Демо: работа в VS Code  (Ctrl+Shift+0)', enabled: on, click: () => demo.work() },
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() },
    ])
  );
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
ipcMain.handle('start-session', (_e, opts) => startSession(opts || {}));
ipcMain.handle('end-session', () => endSession());
ipcMain.handle('set-vision', (_e, on) => {
  visionEnabled = Boolean(on) && mentor.hasAI();
  buildTrayMenu();
  return liveState();
});
ipcMain.handle('chat', async (_e, text) => {
  const res = await mentor.chat(chatHistory, String(text).slice(0, 1000), chatContext());
  applyAction(res); // может дописать reply (например, «запомнил»)
  chatHistory.push({ role: 'user', content: String(text) }, { role: 'assistant', content: res.reply });
  return res;
});

// Окно управления
ipcMain.handle('panel-get', () => panelState());
ipcMain.handle('panel-toggle', () => {
  toggleMentor();
  return panelState();
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
app.on('before-quit', () => (quitting = true));
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
  if (settings.data.startMentorOnOpen || HIDDEN_START) startMentor();
  if (!HIDDEN_START) openPanel();
  if (process.platform === 'darwin' && app.dock && HIDDEN_START) app.dock.hide();
});

app.on('will-quit', () => {
  stopMentor();
  globalShortcut.unregisterAll();
  watcher.stop();
});
