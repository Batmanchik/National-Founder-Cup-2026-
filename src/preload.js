// Безопасный мост между интерфейсом (renderer) и главным процессом.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['activity', 'buddy-say', 'report', 'report-insight', 'vision', 'toggle-chat', 'open-onboarding', 'state'];

contextBridge.exposeInMainWorld('nazar', {
  setInteractive: (on) => ipcRenderer.send('set-interactive', Boolean(on)),
  getState: () => ipcRenderer.invoke('get-state'),
  startSession: (opts) => ipcRenderer.invoke('start-session', opts),
  endSession: () => ipcRenderer.invoke('end-session'),
  setVision: (on) => ipcRenderer.invoke('set-vision', on),
  chat: (text) => ipcRenderer.invoke('chat', text),
  tts: (text) => ipcRenderer.invoke('tts', text),
  setSpeak: (on) => ipcRenderer.invoke('set-speak', on),
  on: (channel, cb) => {
    if (CHANNELS.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
