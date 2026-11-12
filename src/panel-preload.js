// Мост для окна управления. Сам API-ключ обратно в окно никогда не передаётся.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nazarPanel', {
  get: () => ipcRenderer.invoke('panel-get'),
  toggle: () => ipcRenderer.invoke('panel-toggle'),
  save: (patch) => ipcRenderer.invoke('panel-save', patch),
  reset: () => ipcRenderer.invoke('panel-reset'),
  surrender: (phrase) => ipcRenderer.invoke('panel-surrender', phrase),
  onState: (cb) => ipcRenderer.on('panel-state', (_e, state) => cb(state)),
});
