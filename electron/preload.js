const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  saveBackup: (text) => ipcRenderer.invoke('backup:save', text),
  openBackup: () => ipcRenderer.invoke('backup:open'),
  saveImage: (payload) => ipcRenderer.invoke('image:save', payload),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdateStatus: (callback) => ipcRenderer.on('update:status', (_event, payload) => callback(payload))
});
